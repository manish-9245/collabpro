import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { prisma } from '../lib/db';
import { verifyToken } from '../lib/session-auth/jwt';
import Redis from 'ioredis';
import amqplib from 'amqplib';
// Canonical merge/normalization helpers (issue #189). This process runs
// outside the Next.js bundler via tsx, so — like the existing `../lib/db`
// import above — it uses a relative path rather than the "@/" alias.
import {
  asEditorDocument,
  asWhiteboardElements,
  mergeDocumentBlocks,
  mergeWhiteboardPayloads,
} from '../lib/state-sync-helpers';
import { hasFileAccess as checkFileAccessDb } from './file-access';
import { FileAccessCache } from './access-cache';
import {
  selectSubscribedConnections,
  selectRecipientsForRedisMessage,
  deliverToConnections,
} from './collab-broadcast';
import {
  executeQuery as wsExecuteQuery,
  executeMutation as wsExecuteMutation,
  fetchQueryUpdatePayload,
  runMutation,
} from './mutations';


const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : (process.env.WS_PORT ? parseInt(process.env.WS_PORT, 10) : 3001);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

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

    // Consumer to process queue items (GrahakAI Concurrent Merging & Delta boundary)
    mqChannel.consume(QUEUE_NAME, async (msg: any) => {
      if (msg !== null) {
        try {
          const payload = JSON.parse(msg.content.toString());
          const { fileId, type, value } = payload;
          
          const file = await prisma.file.findUnique({
            where: { id: fileId },
            select: { id: true, document: true, whiteboard: true }
          });
          
          let nextValue = value;
          if (file) {
            if (type === 'document') {
              try {
                const currentDoc = asEditorDocument(file.document || '{"blocks":[]}');
                const incomingDoc = asEditorDocument(value);
                nextValue = JSON.stringify(mergeDocumentBlocks(currentDoc, incomingDoc));
              } catch (e) {
                console.error("RabbitMQ doc merge failed, using direct:", e);
              }
            } else if (type === 'whiteboard') {
              try {
                const parsedIncoming = typeof value === 'string' ? JSON.parse(value) : value;
                if (parsedIncoming && parsedIncoming.isDelta) {
                  const currentElements = asWhiteboardElements(file.whiteboard || '[]');
                  const currentMap = new Map();
                  currentElements.forEach((el) => { if (el && el.id) currentMap.set(el.id, el); });
                  
                  if (Array.isArray(parsedIncoming.deleted)) {
                    parsedIncoming.deleted.forEach((id: string) => { currentMap.delete(id); });
                  }
                  if (Array.isArray(parsedIncoming.updated)) {
                    parsedIncoming.updated.forEach((el: any) => { if (el && el.id) currentMap.set(el.id, el); });
                  }
                  nextValue = JSON.stringify(Array.from(currentMap.values()));
                } else {
                  nextValue = mergeWhiteboardPayloads(file.whiteboard || '[]', value);
                }
              } catch (e) {
                console.error("RabbitMQ whiteboard merge failed, using direct:", e);
              }
            }
          }

          const updateData: any = {};
          updateData[type] = nextValue;
          
          await prisma.file.update({
            where: { id: fileId },
            data: updateData,
          });
          console.log(`💾 [RabbitMQ DB Commit] Durable update flushed to DB for file: ${fileId}`);
          mqChannel?.ack(msg);
        } catch (err: any) {
          console.error(`❌ [RabbitMQ DB Commit Error] Failed flushing updates:`, err.message);
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

async function queueDbWrite(fileId: string, type: 'document' | 'whiteboard' | 'fileName', value: string, executeSave: () => Promise<any>): Promise<any> {
  if (mqChannel) {
    try {
      const payload = { fileId, type, value, timestamp: Date.now() };
      mqChannel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(payload)), {
        persistent: true
      });
      return;
    } catch (err) {
      console.warn('[RabbitMQ Queue Error] Failed to publish message, direct save will handle the write:', err);
    }
  }
  return await executeSave();
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
      const decoded = decodeURIComponent(tokenQuery);
      const verified = verifyToken(decoded);
      if (verified) return verified;
      try {
        return JSON.parse(decoded);
      } catch {
        return null;
      }
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

async function checkMutationAuth(connection: ClientConnection, fileId: string, email: string): Promise<{ allowed: boolean; error?: string }> {
  const hasAccess = await hasFileAccess(connection, fileId, email);
  if (!hasAccess) {
    return { allowed: false, error: 'Forbidden: You do not have access to this file' };
  }

  try {
    const file = await prisma.file.findUnique({
      where: { id: fileId },
      select: { createdBy: true, teamId: true }
    });
    if (!file) return { allowed: false, error: 'File not found' };

    if (file.createdBy === email) return { allowed: true };

    const teamMember = await prisma.teamMember.findFirst({
      where: { teamId: file.teamId, userEmail: email },
      select: { role: true }
    });

    if (teamMember) {
      if (teamMember.role === 'viewer') {
        return { allowed: false, error: 'Forbidden: Viewers cannot modify files' };
      }
      return { allowed: true };
    }

    return { allowed: true };
  } catch (error) {
    console.error(`[WS MUTATION AUTH ERROR] Failed to check mutation auth:`, error);
    return { allowed: false, error: 'Internal auth check error' };
  }
}

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
          const targetId = args?._id || args?.fileId;
          // Only clients that supply an explicit, stable mutationId can be
          // de-duplicated. Synthesising one here would make every retry look
          // like a new mutation and cost two Redis round-trips for nothing.
          const mutationId: string | null = args?.mutationId
            ? `${user.id}:${path}:${targetId}:${args.mutationId}`
            : null;
          if (targetId) {
            if (mutationId && await isMutationProcessed(mutationId)) {
              ws.send(JSON.stringify({ type: 'mutation-result', path, success: true, data: { skipped: true } }));
              break;
            }
            const auth = await checkMutationAuth(connection, targetId, user.email);
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
