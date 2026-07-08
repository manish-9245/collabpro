import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { prisma } from '../lib/db';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : (process.env.WS_PORT ? parseInt(process.env.WS_PORT, 10) : 3001);

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
    // 1. Check query parameters
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const tokenQuery = url.searchParams.get('token');
    if (tokenQuery) {
      const decoded = decodeURIComponent(tokenQuery);
      return JSON.parse(decoded);
    }

    // 2. Check Cookie header
    const cookieHeader = req.headers.cookie || '';
    const cookies: Record<string, string> = {};
    cookieHeader.split(';').forEach((cookieStr: string) => {
      const parts = cookieStr.split('=');
      if (parts.length >= 2) {
        cookies[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('='));
      }
    });

    if (cookies['session_token']) {
      return JSON.parse(cookies['session_token']);
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

          // Initial data fetch
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

            // If it is a file-scoped mutation, trigger real-time broad update to the room
            const targetRoom = fileId || args?._id || args?.fileId;
            if (targetRoom) {
              await broadcastQueryUpdateToRoom(targetRoom, 'files:getFileById');
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

// Periodic heartbeat to clean up dead sockets
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

// Helper to execute read queries against Prisma database
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

// Helper to execute state-sync mutations against Prisma database
async function executeMutation(path: string, args: any): Promise<any> {
  switch (path) {
    case 'files:updateDocument': {
      const { _id, document } = args || {};
      const file = await prisma.file.update({
        where: { id: _id },
        data: { document },
      });
      return mapConvexIds(file);
    }
    case 'files:updateWhiteboard': {
      const { _id, whiteboard } = args || {};
      const file = await prisma.file.update({
        where: { id: _id },
        data: { whiteboard },
      });
      return mapConvexIds(file);
    }
    case 'files:updateFileName': {
      const { _id, fileName } = args || {};
      const file = await prisma.file.update({
        where: { id: _id },
        data: { fileName },
      });
      return mapConvexIds(file);
    }
    default:
      throw new Error(`Unsupported or unoptimized mutation over WebSocket: ${path}`);
  }
}

// Broadcast updated query values to all clients in a specific fileId room
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

// Utility mapper to match convex-like schema shape expected by the frontend
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
  console.log(`[GrahakAI WS SERVER] Standalone WebSocket Gateway running on http://localhost:${PORT}`);
});
