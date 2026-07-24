import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { prisma } from '../lib/db';
import { verifyToken } from '../lib/session-auth/jwt';
import Redis from 'ioredis';
import amqplib from 'amqplib';
import * as Y from 'yjs';

// GrahakAI WebSocket Performance Sync Helpers
function parseJsonIfString(value: any): any {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function asEditorDocument(value: any): any {
  const parsed = parseJsonIfString(value);
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.blocks)) {
    return parsed;
  }

  if (typeof parsed === 'string') {
    const text = parsed.trim();
    return {
      time: Date.now(),
      version: "2.8.1",
      blocks: text ? [
        {
          id: String(Math.random()),
          type: 'paragraph',
          data: { text }
        }
      ] : []
    };
  }

  throw new Error("Invalid document payload.");
}

function asWhiteboardElements(value: any): any[] {
  const parsed = parseJsonIfString(value);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.elements)) {
    return parsed.elements;
  }
  return [];
}

function mergeDocumentBlocks(currentDoc: any, incomingDoc: any): any {
  const currentBlocks = Array.isArray(currentDoc.blocks) ? currentDoc.blocks : [];
  const incomingBlocks = Array.isArray(incomingDoc.blocks) ? incomingDoc.blocks : [];
  return {
    ...currentDoc,
    ...incomingDoc,
    time: Date.now(),
    blocks: [
      ...currentBlocks,
      ...incomingBlocks.map((block: any) =>
        block && typeof block === 'object' && block.id ? block : { ...block, id: String(Math.random()) }
      )
    ]
  };
}

function mergeWhiteboardById(currentElements: any[], incomingElements: any[]): any[] {
  const merged = new Map<string, any>();
  const ordered: string[] = [];

  for (const element of currentElements) {
    if (!element || typeof element !== 'object') continue;
    const key = typeof element.id === 'string' && element.id.length > 0 ? element.id : String(Math.random());
    if (!merged.has(key)) ordered.push(key);
    merged.set(key, element);
  }

  for (const element of incomingElements) {
    if (!element || typeof element !== 'object') continue;
    const key = typeof element.id === 'string' && element.id.length > 0 ? element.id : String(Math.random());
    if (!merged.has(key)) ordered.push(key);
    merged.set(key, element);
  }

  return ordered.map((key) => merged.get(key)).filter(Boolean);
}

function mergeWhiteboardPayloads(currentStr: string, incomingStr: string): string {
  try {
    const currentParsed = parseJsonIfString(currentStr);
    const incomingParsed = parseJsonIfString(incomingStr);

    if (currentParsed && typeof currentParsed === 'object' && currentParsed.yjs && currentParsed.data && 
        incomingParsed && typeof incomingParsed === 'object' && incomingParsed.yjs && incomingParsed.data) {
      const currentUpdate = Buffer.from(currentParsed.data, 'base64');
      const incomingUpdate = Buffer.from(incomingParsed.data, 'base64');
      const mergedUpdate = Y.mergeUpdates([new Uint8Array(currentUpdate), new Uint8Array(incomingUpdate)]);
      const base64 = Buffer.from(mergedUpdate).toString('base64');
      return JSON.stringify({
        yjs: true,
        data: base64
      });
    }
  } catch (e) {
    console.error("Yjs merge failed in mergeWhiteboardPayloads:", e);
  }

  try {
    const currentElements = asWhiteboardElements(currentStr || '[]');
    const incomingElements = asWhiteboardElements(incomingStr);
    const mergedElements = mergeWhiteboardById(currentElements, incomingElements);
    return JSON.stringify(mergedElements);
  } catch (e) {
    return incomingStr;
  }
}


const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : (process.env.WS_PORT ? parseInt(process.env.WS_PORT, 10) : 3001);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

interface ClientConnection {
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
        const { type, fileId, senderEmail, payload } = parsed;

        activeConnections.forEach((conn) => {
          if (conn.user.id !== senderEmail && conn.joinedRooms.has(fileId)) {
            conn.ws.send(JSON.stringify(payload));
          }
        });
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

async function hasFileAccess(fileId: string, email: string): Promise<boolean> {
  if (!fileId || !email) return false;
  try {
    const file = await prisma.file.findUnique({
      where: { id: fileId }
    });
    if (!file) return false;
    if (file.createdBy === email) return true;
    
    const teamMember = await prisma.teamMember.findFirst({
      where: {
        teamId: file.teamId,
        userEmail: email
      }
    });
    return !!teamMember;
  } catch (error) {
    console.error(`[WS AUTH CHECK ERROR] Failed to check access:`, error);
    return false;
  }
}

async function checkMutationAuth(fileId: string, email: string): Promise<{ allowed: boolean; error?: string }> {
  const hasAccess = await hasFileAccess(fileId, email);
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
    ws,
    user,
    joinedRooms: new Set<string>(),
    subscriptions: new Map<string, { path: string; args: any }>(),
    isAlive: true,
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
            const hasAccess = await hasFileAccess(fileId, user.email);
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
            const hasAccess = await hasFileAccess(fileId, user.email);
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
            const hasAccess = await hasFileAccess(fileId, user.email);
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
            const auth = await checkMutationAuth(targetId, user.email);
            if (!auth.allowed) {
              console.warn(`[WS MUTATION SECURITY REJECT] User ${user.id} attempted unauthorized mutation "${path}" on: ${targetId}: ${auth.error}`);
              ws.send(JSON.stringify({ type: 'error', message: auth.error }));
              break;
            }
          }
          console.log(`[WS MUTATION] Executing mutation "${path}" for fileId "${fileId}"`);

          try {
            const result = await executeMutation(path, args);
            if (mutationId) {
              await markMutationProcessed(mutationId);
            }
            ws.send(JSON.stringify({ type: 'mutation-result', path, success: true, data: result }));

            const targetRoom = fileId || args?._id || args?.fileId;
            if (targetRoom) {
              // 1. Broadcast locally
              await broadcastQueryUpdateToRoom(targetRoom, 'files:getFileById');

              // 2. Publish to Redis for cluster updates
              if (pubClient && isRedisAvailable) {
                const updatedData = await executeQuery('files:getFileById', { _id: targetRoom });
                pubClient.publish('collabpro:channel:canvas', JSON.stringify({
                  type: 'mutation-update',
                  fileId: targetRoom,
                  senderEmail: user.id,
                  payload: {
                    type: 'query-update',
                    path: 'files:getFileById',
                    args: { _id: targetRoom },
                    data: updatedData,
                  }
                })).catch((err) => { console.error("Redis mutation publish failed:", err); });
              }
            }
          } catch (err: any) {
            console.error(`[WS MUTATION ERROR] Mutation failed:`, err);
            ws.send(JSON.stringify({ type: 'mutation-result', path, success: false, error: err.message }));
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

async function executeQuery(path: string, args: any): Promise<any> {
  try {
    switch (path) {
      case 'files:getFileById': {
        const { _id } = args || {};

        const file = await prisma.file.findUnique({
          where: { id: _id },
        });

        return mapConvexIds(file);
      }
      default:
        console.warn(`[WS QUERY] No specific optimization for query path: ${path}`);
        return null;
    }
  } catch (err) {
    console.error(`[WS QUERY ERROR] Failed executing ${path}:`, err);
    return null;
  }
}

async function executeMutation(path: string, args: any): Promise<any> {
  switch (path) {
    case 'files:updateDocument': {
      const { _id, document } = args || {};

      await queueDbWrite(_id, 'document', document, async () => {
        const file = await prisma.file.findUnique({
          where: { id: _id },
          select: { document: true }
        });
        let nextValue = document;
        if (file) {
          try {
            const currentDoc = asEditorDocument(file.document || '{"blocks":[]}');
            const incomingDoc = asEditorDocument(document);
            nextValue = JSON.stringify(mergeDocumentBlocks(currentDoc, incomingDoc));
          } catch (e) {
            console.error("Document merge failed in executeMutation:", e);
          }
        }
        return prisma.file.update({
          where: { id: _id },
          data: { document: nextValue },
        });
      });

      return { id: _id, document, _id };
    }
    case 'files:updateWhiteboard': {
      const { _id, whiteboard } = args || {};

      await queueDbWrite(_id, 'whiteboard', whiteboard, async () => {
        const file = await prisma.file.findUnique({
          where: { id: _id },
          select: { whiteboard: true }
        });
        let nextValue = whiteboard;
        if (file) {
          try {
            const parsedIncoming = typeof whiteboard === 'string' ? JSON.parse(whiteboard) : whiteboard;
            if (parsedIncoming && parsedIncoming.isDelta) {
              const currentElements = asWhiteboardElements(file.whiteboard || '[]');
              const currentMap = new Map<string, any>();
              currentElements.forEach((el: any) => { if (el && el.id) currentMap.set(el.id, el); });
              
              if (Array.isArray(parsedIncoming.deleted)) {
                parsedIncoming.deleted.forEach((id: string) => { currentMap.delete(id); });
              }
              if (Array.isArray(parsedIncoming.updated)) {
                parsedIncoming.updated.forEach((el: any) => { if (el && el.id) currentMap.set(el.id, el); });
              }
              nextValue = JSON.stringify(Array.from(currentMap.values()));
            } else {
              nextValue = mergeWhiteboardPayloads(file.whiteboard || '[]', whiteboard);
            }
          } catch (e) {
            console.error("Whiteboard merge failed in executeMutation:", e);
          }
        }
        return prisma.file.update({
          where: { id: _id },
          data: { whiteboard: nextValue },
        });
      });

      return { id: _id, whiteboard, _id };
    }
    case 'files:updateFileName': {
      const { _id, fileName } = args || {};

      await queueDbWrite(_id, 'fileName', fileName, async () => {
        return prisma.file.update({
          where: { id: _id },
          data: { fileName },
        });
      });

      return { id: _id, fileName, _id };
    }
    default:
      throw new Error(`Unsupported or unoptimized mutation over WebSocket: ${path}`);
  }
}

async function broadcastQueryUpdateToRoom(fileId: string, queryPath: string) {
  const updatedData = await executeQuery(queryPath, { _id: fileId });
  const payload = JSON.stringify({
    type: 'query-update',
    path: queryPath,
    args: { _id: fileId },
    data: updatedData,
  });

  let recipientCount = 0;
  activeConnections.forEach((conn) => {
    if (conn.joinedRooms.has(fileId)) {
      const subKey = `${queryPath}:${JSON.stringify({ _id: fileId })}`;
      if (conn.subscriptions.has(subKey)) {
        conn.ws.send(payload);
        recipientCount++;
      }
    }
  });

  console.log(`[WS BROADCAST] Pushed query update "${queryPath}" for room "${fileId}" to ${recipientCount} subscribers.`);
}

function mapConvexIds(obj: any): any {
  if (!obj) return obj;
  if (Array.isArray(obj)) {
    return obj.map(mapConvexIds);
  }
  if (typeof obj === 'object') {
    if (obj instanceof Date) return obj.toISOString();

    const newObj: any = {};
    for (const key of Object.getOwnPropertyNames(obj)) {
      newObj[key] = mapConvexIds(obj[key]);
    }
    for (const key in obj) {
      if (!(key in newObj)) {
        newObj[key] = mapConvexIds(obj[key]);
      }
    }
    if (obj.id !== undefined && obj._id === undefined) {
      newObj._id = obj.id;
    }
    return newObj;
  }
  return obj;
}

server.listen(PORT, () => {
  console.log(`[CollabPro WS SERVER] Standalone WebSocket Gateway running on http://localhost:${PORT}`);
});
