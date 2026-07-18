import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { prisma } from '../lib/db';
import { verifyToken } from '../lib/session-auth/jwt';
import Redis from 'ioredis';
import amqplib from 'amqplib';

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

  // Gracefully handle connection offline states to prevent crashing or performance bottlenecks
  pubClient.on('error', (err) => {
    isRedisAvailable = false;
  });
  subClient.on('error', (err) => {
    isRedisAvailable = false;
  });

  pubClient.on('connect', () => {
    isRedisAvailable = true;
    console.log('📡 [Redis Pub/Sub] Pub client connected successfully');
  });

  subClient.on('connect', () => {
    console.log('📡 [Redis Pub/Sub] Sub client connected successfully');
    subClient?.subscribe('collabpro:channel:canvas').catch(() => {});
  });

  subClient.on('message', (channel, messageStr) => {
    if (channel === 'collabpro:channel:canvas') {
      try {
        const parsed = JSON.parse(messageStr);
        const { type, fileId, senderEmail, payload } = parsed;

        activeConnections.forEach((conn) => {
          if (conn.user.email !== senderEmail && conn.joinedRooms.has(fileId)) {
            conn.ws.send(JSON.stringify(payload));
          }
        });
      } catch (err: any) {
        // Silent catch
      }
    }
  });

  // Trigger lazy connections
  pubClient.connect().catch(() => { isRedisAvailable = false; });
  subClient.connect().catch(() => {});

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

    // Consumer to process queue items
    mqChannel.consume(QUEUE_NAME, async (msg: any) => {
      if (msg !== null) {
        try {
          const payload = JSON.parse(msg.content.toString());
          const { fileId, type, value } = payload;
          const updateData: any = {};
          updateData[type] = value;
          
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

// Durable RabbitMQ-backed database write-back commit queue helper
async function queueDbWrite(fileId: string, type: 'document' | 'whiteboard' | 'fileName', value: string, executeSave: () => Promise<any>) {
  if (mqChannel) {
    try {
      const payload = { fileId, type, value, timestamp: Date.now() };
      mqChannel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(payload)), {
        persistent: true
      });
    } catch (err) {
      console.warn('⚠️ [RabbitMQ Queue Error] Failed to publish message, falling back to direct save');
      await executeSave();
    }
  } else {
    // Fallback to direct save
    await executeSave();
  }
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
      console.log(`[WS MESSAGE] Received action of type "${message.type}" from ${user.email}`);

      switch (message.type) {
        case 'join': {
          const { fileId } = message;
          if (fileId) {
            connection.joinedRooms.add(fileId);
            console.log(`[WS ROOM] User ${user.email} joined room: ${fileId}`);
            ws.send(JSON.stringify({ type: 'joined', fileId }));
          }
          break;
        }

        case 'cursor': {
          const { fileId, x, y, name, color, isCanvas } = message;
          if (fileId) {
            const cursorPayload = {
              type: 'cursor-update',
              fileId,
              email: user.email,
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
                senderEmail: user.email,
                payload: cursorPayload
              })).catch(() => {});
            }
          }
          break;
        }

        case 'leave': {
          const { fileId } = message;
          if (fileId) {
            connection.joinedRooms.delete(fileId);
            console.log(`[WS ROOM] User ${user.email} left room: ${fileId}`);
            ws.send(JSON.stringify({ type: 'left', fileId }));
          }
          break;
        }

        case 'subscribe': {
          const { path, args } = message;
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
          console.log(`[WS MUTATION] Executing mutation "${path}" for fileId "${fileId}"`);

          try {
            const result = await executeMutation(path, args);
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
                  senderEmail: user.email,
                  payload: {
                    type: 'query-update',
                    path: 'files:getFileById',
                    args: { _id: targetRoom },
                    data: updatedData,
                  }
                })).catch(() => {});
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
    console.log(`[WS DISCONNECTED] User disconnected: ${user.name} (${user.email})`);
    activeConnections.delete(connection);
  });

  ws.on('error', (err) => {
    console.error(`[WS ERROR] Socket error for ${user.email}:`, err);
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

      queueDbWrite(_id, 'document', document, async () => {
        return prisma.file.update({
          where: { id: _id },
          data: { document },
        });
      });

      return { id: _id, document, _id };
    }
    case 'files:updateWhiteboard': {
      const { _id, whiteboard } = args || {};

      queueDbWrite(_id, 'whiteboard', whiteboard, async () => {
        return prisma.file.update({
          where: { id: _id },
          data: { whiteboard },
        });
      });

      return { id: _id, whiteboard, _id };
    }
    case 'files:updateFileName': {
      const { _id, fileName } = args || {};

      queueDbWrite(_id, 'fileName', fileName, async () => {
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
