import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { prisma } from '../lib/db';
import { verifyToken } from '../lib/session-auth/jwt';
import Redis from 'ioredis';
import amqplib from 'amqplib';
import { hasFileAccess as checkFileAccessDb, checkMutationAuth as checkMutationAuthDb, resolveTokenUser, resolveMutationAuthStrategy } from './file-access';
import { checkTeamAccess as checkTeamAccessDb, type TeamAccessPrismaClient } from '../lib/team-access';
import { FileAccessCache } from './access-cache';
import {
  selectSubscribedConnections,
  selectRecipientsForRedisMessage,
  deliverToConnections,
  isSelfOriginatedMessage,
} from './collab-broadcast';
import {
  executeQuery as wsExecuteQuery,
  executeMutation as wsExecuteMutation,
  fetchQueryUpdatePayload,
  runMutation,
} from './mutations';
import { queueDbWrite as sharedQueueDbWrite } from './queue-db-write';


const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : (process.env.WS_PORT ? parseInt(process.env.WS_PORT, 10) : 3001);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

// Issue found in review (Group 5 #2): a unique id for this process/replica,
// stamped onto every Redis publish so the Redis-consume path can recognize
// (and skip) a message this same replica already delivered locally — Redis
// pub/sub otherwise echoes a publish back to the publisher's own
// subscription, causing local subscribers to receive it twice.
const REPLICA_ID = crypto.randomUUID();

interface ClientConnection {
  id: string;
  ws: WebSocket;
  user: {
    id: string;
    email: string;
    name: string;
    image?: string;
  };
  joinedRooms: Set<string>;
  subscriptions: Map<string, { path: string; args: any }>;
  isAlive: boolean;
  // Issue #198: per-connection file-access decision cache (short TTL),
  // populated on `join`, consulted by the `cursor` and mutation handlers so
  // steady-state cursor traffic never hits the database.
  accessCache: FileAccessCache;
}

async function hasFileAccess(connection: ClientConnection, fileId: string, email: string): Promise<boolean> {
  const cached = connection.accessCache.get(connection.id, fileId);
  if (cached !== undefined) return cached;

  const allowed = await checkFileAccessDb(prisma, fileId, email);
  connection.accessCache.set(connection.id, fileId, allowed);
  return allowed;
}

const activeConnections = new Set<ClientConnection>();

// Setup horizontal scaling via Resilient Redis Pub/Sub
let pubClient: Redis | null = null;
let subClient: Redis | null = null;
let writeClient: Redis | null = null;
let isRedisAvailable = false;

try {
  pubClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    lazyConnect: true,
  });

  subClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    lazyConnect: true,
  });

  // A subscriber connection cannot issue regular commands, so idempotency
  // markers need their own client.
  writeClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    lazyConnect: true,
  });

  // Gracefully handle connection offline states to prevent crashing or performance bottlenecks
  pubClient.on('error', (err) => {
    isRedisAvailable = false;
  });
  subClient.on('error', (err) => {
    isRedisAvailable = false;
  });
  writeClient.on('error', (err) => {
    console.error('Redis write client error:', err.message);
  });

  pubClient.on('connect', () => {
    isRedisAvailable = true;
    console.log('📡 [Redis Pub/Sub] Pub client connected successfully');
  });

  subClient.on('connect', () => {
    console.log('📡 [Redis Pub/Sub] Sub client connected successfully');
    subClient?.subscribe('collabpro:channel:canvas').catch((err) => { console.error('Redis subscribe failed:', err); });
  });

  subClient.on('message', (channel, messageStr) => {
    if (channel === 'collabpro:channel:canvas') {
      try {
        const parsed = JSON.parse(messageStr);

        // Issue found in review (Group 5 #2): skip a message this exact
        // replica published itself — it was already delivered to local
        // connections directly, and Redis pub/sub otherwise echoes the
        // publish back through this replica's own subscription, causing
        // double delivery.
        if (isSelfOriginatedMessage(parsed, REPLICA_ID)) return;

        const { fileId, senderEmail, payload } = parsed;

        // Issue #197 (partial): route through the same recipient-selection
        // logic the local same-process broadcast uses, so a `query-update`
        // received from another replica only reaches connections actually
        // subscribed to that query (not every connection merely joined to
        // the room, which is still correct for cursor/other payload types).
        const recipients = selectRecipientsForRedisMessage(activeConnections, { fileId, senderEmail, payload });
        deliverToConnections(recipients, payload);
      } catch (err: any) {
        console.error("Redis message handler failed:", err);
      }
    }
  });

  // Trigger lazy connections
  pubClient.connect().catch((err) => { isRedisAvailable = false; console.error("Redis pub client connect failed:", err); });
  subClient.connect().catch((err) => { console.error("Redis sub client connect failed:", err); });
  writeClient.connect().catch((err) => { console.error("Redis write client connect failed:", err); });

} catch (err: any) {
  console.warn('⚠️ [Redis Pub/Sub Warning] Operating in standalone memory mode:', err.message);
}

// Set up RabbitMQ Connection and Channel
let mqConnection: any = null;
let mqChannel: any = null;
const QUEUE_NAME = 'collabpro_db_writes';

async function initRabbitMQ() {
  try {
    mqConnection = await amqplib.connect(RABBITMQ_URL);
    mqChannel = await mqConnection.createChannel();
    await mqChannel.assertQueue(QUEUE_NAME, { durable: true });
    console.log('🐇 [RabbitMQ] Connected to message broker successfully.');

    // Consumer for this queue. `queueDbWrite` below performs the
    // authoritative write synchronously and awaits it BEFORE this message
    // is ever published — by the time a message reaches here, the write it
    // describes has already committed. This consumer does not persist or
    // replay anything (see the bug this avoids, below) — it only drains the
    // queue and logs receipt so messages don't pile up unacked. It is NOT
    // an audit trail: nothing here is queryable or retained. If a real
    // audit/durability record of these writes is needed later, that
    // requires actually persisting `payload` somewhere (a table, a log
    // shipper, etc.) — not this queue, which #170 already tracks as
    // largely-unused infrastructure to reconsider.
    //
    // Bug found in review (round 2, Group 1): this used to re-apply `value`
    // via casUpdateDocument/casUpdateWhiteboard. That looks idempotent but
    // isn't: the CAS predicate only checks "does the row's CURRENT raw value
    // match what I just read", not "is my payload actually the newest
    // version" — so a message that sits in the queue (broker restart,
    // redelivery, slow consumer) and gets processed after one or more
    // *newer* direct writes already landed would still pass that predicate
    // (current == what this replay just read) and overwrite the newer
    // content with this stale `value`. Never re-applying the write here
    // removes that class of bug entirely.
    mqChannel.consume(QUEUE_NAME, async (msg: any) => {
      if (msg !== null) {
        try {
          const payload = JSON.parse(msg.content.toString());
          console.log(`💾 [RabbitMQ] Drained record for file: ${payload.fileId} (${payload.type}) — write already committed synchronously, not persisted here.`);
          mqChannel?.ack(msg);
        } catch (err: any) {
          console.error(`❌ [RabbitMQ] Failed to parse queued record:`, err.message);
          mqChannel?.nack(msg, false, false); // Do not requeue on fatal error
        }
      }
    });

    mqConnection.on('error', (err: any) => {
      console.error('RabbitMQ connection error:', err);
    });
    mqConnection.on('close', () => {
      console.warn('RabbitMQ connection closed. Reconnecting...');
      setTimeout(initRabbitMQ, 5000);
    });
  } catch (error) {
    console.warn('⚠️ [RabbitMQ Warning] Could not connect to RabbitMQ. Falling back to direct database writes.', error);
    setTimeout(initRabbitMQ, 5000);
  }
}

initRabbitMQ();

const PROCESSED_MUTATIONS_KEY = 'collabpro:ws:processed-mutations';

async function isMutationProcessed(mutationId: string): Promise<boolean> {
  if (!writeClient || !isRedisAvailable) return false;
  try {
    const exists = await writeClient.exists(`${PROCESSED_MUTATIONS_KEY}:${mutationId}`);
    return exists === 1;
  } catch {
    return false;
  }
}

async function markMutationProcessed(mutationId: string): Promise<void> {
  if (!writeClient || !isRedisAvailable) return;
  try {
    await writeClient.setex(`${PROCESSED_MUTATIONS_KEY}:${mutationId}`, 3600, '1');
  } catch {
    // best-effort idempotency marker
  }
}

// Issue found in review round 2 (Group 1 — regression against #172):
// previously defined inline here, resolving as soon as a message was handed
// to RabbitMQ rather than once the DB write actually completed, so the
// client could be told "saved" before the write was even attempted. Now
// delegates to the shared, unit-tested `./queue-db-write.ts`, which always
// executes and awaits the authoritative save first.
function queueDbWrite(fileId: string, type: 'document' | 'whiteboard' | 'fileName', value: string, executeSave: () => Promise<any>): Promise<any> {
  return sharedQueueDbWrite(mqChannel, QUEUE_NAME, fileId, type, value, executeSave);
}

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', connections: activeConnections.size }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocketServer({ noServer: true });

// Handle standard cookie and query parameter parsing for secure auth
function authenticateRequest(req: any): any {
  try {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const tokenQuery = url.searchParams.get('token');
    if (tokenQuery) {
      return resolveTokenUser(tokenQuery, verifyToken);
    }

    const cookieHeader = req.headers.cookie || '';
    const cookies: Record<string, string> = {};
    cookieHeader.split(';').forEach((cookieStr: string) => {
      const parts = cookieStr.split('=');
      if (parts.length >= 2) {
        cookies[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('='));
      }
    });

    if (cookies['session_token']) {
      return verifyToken(cookies['session_token']);
    }
  } catch (err) {
    console.error('[WS HANDSHAKE] Auth parsing failed:', err);
  }
  return null;
}

// checkMutationAuth (imported from ./file-access) deliberately does NOT go
// through `connection.accessCache` — see the doc comment on it. Mutation
// authorization always re-checks the database fresh; only cursor traffic
// (via `hasFileAccess` above) is allowed to trade a short staleness window
// for not hitting the DB on every message (issue found in review, Group 5 #1).

server.on('upgrade', (request, socket, head) => {
  console.log('[WS HANDSHAKE] Upgrade request received...');
  const user = authenticateRequest(request);

  if (!user) {
    console.log('[WS HANDSHAKE] Unauthorized connection attempt rejected.');
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request, user);
  });
});

wss.on('connection', (ws: WebSocket, request: any, user: any) => {
  console.log(`[WS CONNECTED] User connected: ${user.name} (${user.email})`);

  const connection: ClientConnection = {
    id: crypto.randomUUID(),
    ws,
    user,
    joinedRooms: new Set<string>(),
    subscriptions: new Map<string, { path: string; args: any }>(),
    isAlive: true,
    accessCache: new FileAccessCache(),
  };

  activeConnections.add(connection);

  ws.on('pong', () => {
    connection.isAlive = true;
  });

  ws.on('message', async (messageData) => {
    try {
      const message = JSON.parse(messageData.toString());
      console.log(`[WS MESSAGE] Received action of type "${message.type}" from ${user.id}`);

      switch (message.type) {
        case 'join': {
          const { fileId } = message;
          if (fileId) {
            const hasAccess = await hasFileAccess(connection, fileId, user.email);
            if (!hasAccess) {
              console.warn(`[WS ROOM SECURITY REJECT] User ${user.id} attempted unauthorized join to: ${fileId}`);
              ws.send(JSON.stringify({ type: 'error', message: 'Forbidden: You do not have access to this room' }));
              break;
            }
            connection.joinedRooms.add(fileId);
            console.log(`[WS ROOM] User ${user.id} joined room: ${fileId}`);
            ws.send(JSON.stringify({ type: 'joined', fileId }));
          }
          break;
        }

        case 'cursor': {
          const { fileId, x, y, name, color, isCanvas } = message;
          if (fileId) {
            const hasAccess = await hasFileAccess(connection, fileId, user.email);
            if (!hasAccess) {
              break;
            }
            const cursorPayload = {
              type: 'cursor-update',
              fileId,
              email: user.id,
              name: name || user.name || user.email.split('@')[0],
              color: color || '#2563eb',
              x,
              y,
              isCanvas: !!isCanvas,
              updatedAt: Date.now()
            };

            // 1. Broadcast locally
            activeConnections.forEach((conn) => {
              if (conn !== connection && conn.joinedRooms.has(fileId)) {
                conn.ws.send(JSON.stringify(cursorPayload));
              }
            });

            // 2. Publish to Redis for horizontal scale
            if (pubClient && isRedisAvailable) {
              pubClient.publish('collabpro:channel:canvas', JSON.stringify({
                type: 'cursor',
                fileId,
                senderEmail: user.id,
                originId: REPLICA_ID,
                payload: cursorPayload
              })).catch((err) => { console.error("Redis cursor publish failed:", err); });
            }
          }
          break;
        }

        case 'leave': {
          const { fileId } = message;
          if (fileId) {
            connection.joinedRooms.delete(fileId);
            console.log(`[WS ROOM] User ${user.id} left room: ${fileId}`);
            ws.send(JSON.stringify({ type: 'left', fileId }));
          }
          break;
        }

        case 'subscribe': {
          const { path, args } = message;
          if (path === 'files:getFileById') {
            const fileId = args?._id || args?.fileId;
            const hasAccess = await hasFileAccess(connection, fileId, user.email);
            if (!hasAccess) {
              console.warn(`[WS SUB SECURITY REJECT] User ${user.id} attempted unauthorized subscription to: ${fileId}`);
              ws.send(JSON.stringify({ type: 'error', message: 'Forbidden: You do not have access to this subscription' }));
              break;
            }
          }
          const subKey = `${path}:${JSON.stringify(args || {})}`;
          connection.subscriptions.set(subKey, { path, args });
          console.log(`[WS SUB] User ${user.email} subscribed to: ${subKey}`);

          const initialData = await executeQuery(path, args);
          ws.send(JSON.stringify({ type: 'query-update', path, args, data: initialData }));
          break;
        }

        case 'unsubscribe': {
          const { path, args } = message;
          const subKey = `${path}:${JSON.stringify(args || {})}`;
          connection.subscriptions.delete(subKey);
          console.log(`[WS UNSUB] User ${user.email} unsubscribed from: ${subKey}`);
          break;
        }

        case 'mutation': {
          const { path, args, fileId } = message;
          const authStrategy = resolveMutationAuthStrategy(path, args);
          let mutationId: string | null = null;

          if (authStrategy.type === 'team') {
            const hasTeamAccess = await checkTeamAccessDb(prisma as unknown as TeamAccessPrismaClient, authStrategy.teamId, user.email);
            if (!hasTeamAccess) {
              console.warn(`[WS MUTATION SECURITY REJECT] User ${user.id} attempted unauthorized files:createFile for team: ${authStrategy.teamId}`);
              ws.send(JSON.stringify({ type: 'error', message: 'Forbidden: You do not have access to this team' }));
              break;
            }
          } else if (authStrategy.type === 'existing') {
            const targetId = authStrategy.targetId;
            // Only clients that supply an explicit, stable mutationId can be
            // de-duplicated. Synthesising one here would make every retry look
            // like a new mutation and cost two Redis round-trips for nothing.
            mutationId = args?.mutationId
              ? `${user.id}:${path}:${targetId}:${args.mutationId}`
              : null;
            if (mutationId && await isMutationProcessed(mutationId)) {
              ws.send(JSON.stringify({ type: 'mutation-result', path, success: true, data: { skipped: true } }));
              break;
            }
            const auth = await checkMutationAuthDb(prisma as any, targetId, user.email);
            if (!auth.allowed) {
              console.warn(`[WS MUTATION SECURITY REJECT] User ${user.id} attempted unauthorized mutation "${path}" on: ${targetId}: ${auth.error}`);
              ws.send(JSON.stringify({ type: 'error', message: auth.error }));
              break;
            }
          }
          console.log(`[WS MUTATION] Executing mutation "${path}" for fileId "${fileId}"`);

          // Issue #172 remainder: routed through runMutation() so a
          // rejection from the (now properly awaited) queueDbWrite call
          // inside executeMutation reaches the client as
          // `{ success: false }` instead of being reported as success
          // regardless.
          const resultMessage = await runMutation(executeMutation, path, args);
          ws.send(JSON.stringify(resultMessage));

          if (!resultMessage.success) {
            console.error(`[WS MUTATION ERROR] Mutation "${path}" failed:`, resultMessage.error);
            break;
          }

          if (mutationId) {
            await markMutationProcessed(mutationId);
          }

          const targetRoom = fileId || args?._id || args?.fileId;
          if (targetRoom) {
            // Issue #198 / #197 (partial): read the file exactly ONCE and
            // reuse it for both the local broadcast and the Redis publish
            // (previously fetched separately for each), and route the local
            // delivery through the same subscription-matching selector used
            // for cross-replica messages received over Redis, so both paths
            // agree on who gets the update.
            const { payload: queryUpdatePayload } = await fetchQueryUpdatePayload(prisma, targetRoom);

            const localRecipients = selectSubscribedConnections(
              activeConnections,
              targetRoom,
              'files:getFileById',
              { _id: targetRoom }
            );
            const recipientCount = deliverToConnections(localRecipients, queryUpdatePayload);
            console.log(`[WS BROADCAST] Pushed query update "files:getFileById" for room "${targetRoom}" to ${recipientCount} subscribers.`);

            if (pubClient && isRedisAvailable) {
              pubClient.publish('collabpro:channel:canvas', JSON.stringify({
                type: 'mutation-update',
                fileId: targetRoom,
                senderEmail: user.id,
                originId: REPLICA_ID,
                payload: queryUpdatePayload,
              })).catch((err) => { console.error("Redis mutation publish failed:", err); });
            }
          }
          break;
        }

        default:
          console.warn(`[WS WARNING] Unknown message type: ${message.type}`);
          ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${message.type}` }));
      }
    } catch (err) {
      console.error('[WS MESSAGE ERROR] Failed to process message:', err);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid payload format' }));
    }
  });

  ws.on('close', () => {
    console.log(`[WS DISCONNECTED] User disconnected: ${user.name} (${user.id})`);
    activeConnections.delete(connection);
  });

  ws.on('error', (err) => {
    console.error(`[WS ERROR] Socket error for connection:`, err);
  });
});

const heartbeatInterval = setInterval(() => {
  activeConnections.forEach((conn) => {
    if (!conn.isAlive) {
      console.log(`[WS TIMEOUT] Terminating dead connection for ${conn.user.email}`);
      conn.ws.terminate();
      activeConnections.delete(conn);
      return;
    }
    conn.isAlive = false;
    conn.ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// Issue #189: executeQuery/executeMutation used to be defined inline here,
// duplicating (and diverging from) the Next.js app's copy. They're now
// extracted to ./mutations.ts (parameterized on the prisma client and
// queueDbWrite so they're unit-testable without a live socket harness) and
// bound to the real prisma client / queueDbWrite here.
const executeQuery = (path: string, args: any) => wsExecuteQuery(prisma, path, args);
const executeMutation = (path: string, args: any) => wsExecuteMutation(prisma, queueDbWrite, path, args);

server.listen(PORT, () => {
  console.log(`[CollabPro WS SERVER] Standalone WebSocket Gateway running on http://localhost:${PORT}`);
});
