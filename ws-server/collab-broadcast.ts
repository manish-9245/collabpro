/**
 * Pure recipient-selection / payload-building logic shared by the local
 * same-process broadcast and the cross-replica Redis pub/sub fan-out
 * (issue #197 partial — WS registry completion).
 *
 * Previously `broadcastQueryUpdateToRoom` only ever walked the local
 * `activeConnections` set, so a client subscribed via `subscribe` on one
 * replica never received a `query-update` caused by a mutation handled on a
 * different replica — even though cursor/mutation events already fanned out
 * over Redis (`collabpro:channel:canvas`). These functions let both the
 * local delivery and the Redis-message delivery path share one
 * implementation, and are intentionally free of WebSocket/Redis/Prisma so
 * they're unit-testable without a live socket harness.
 */

export interface ClientConnectionLike {
  ws: { send: (data: string) => void };
  user: { id: string };
  joinedRooms: Set<string>;
  subscriptions: Map<string, { path: string; args: any }>;
}

export function subscriptionKey(path: string, args: any): string {
  return `${path}:${JSON.stringify(args || {})}`;
}

export function buildQueryUpdatePayload(path: string, args: any, data: any) {
  return { type: 'query-update', path, args, data };
}

/** Connections joined to `fileId` AND subscribed to this exact query. */
export function selectSubscribedConnections<T extends ClientConnectionLike>(
  connections: Iterable<T>,
  fileId: string,
  path: string,
  args: any
): T[] {
  const key = subscriptionKey(path, args);
  const result: T[] = [];
  for (const conn of connections) {
    if (conn.joinedRooms.has(fileId) && conn.subscriptions.has(key)) {
      result.push(conn);
    }
  }
  return result;
}

/** Every connection joined to `fileId`, except the excluded sender (if any). */
export function selectRoomConnections<T extends ClientConnectionLike>(
  connections: Iterable<T>,
  fileId: string,
  excludeUserId?: string
): T[] {
  const result: T[] = [];
  for (const conn of connections) {
    if (conn.joinedRooms.has(fileId) && conn.user.id !== excludeUserId) {
      result.push(conn);
    }
  }
  return result;
}

export function deliverToConnections<T extends ClientConnectionLike>(connections: T[], payload: any): number {
  const json = JSON.stringify(payload);
  connections.forEach((conn) => conn.ws.send(json));
  return connections.length;
}

/**
 * True if a message received over the cross-replica Redis pub/sub channel
 * was published by THIS exact replica (issue found in review, Group 5 #2).
 *
 * Redis pub/sub delivers a published message to every subscriber of the
 * channel, including the publisher itself if it's also subscribed —
 * `collabpro:channel:canvas` is both published to and subscribed from every
 * replica. Without this check, a replica that already delivered a
 * cursor/query-update locally would deliver it a SECOND time when its own
 * publish echoed back through its own subscription. Every publish must be
 * tagged with `originId: <this replica's id>`, and the Redis-consume path
 * skips messages that match.
 */
export function isSelfOriginatedMessage(message: { originId?: string }, thisReplicaId: string): boolean {
  return !!message.originId && message.originId === thisReplicaId;
}

/**
 * Given a message received over the cross-replica Redis pub/sub channel,
 * decides which local connections should receive it. `query-update`
 * payloads are routed through the same subscription-matching rule the local
 * broadcast uses (so a client that isn't actually subscribed to that query
 * doesn't get spurious pushes); other payload types (cursor-update, etc.)
 * keep the existing "everyone in the room but the sender" behavior.
 */
export function selectRecipientsForRedisMessage<T extends ClientConnectionLike>(
  connections: Iterable<T>,
  message: { fileId: string; senderEmail?: string; payload: { type: string; path?: string; args?: any } }
): T[] {
  if (message.payload?.type === 'query-update' && message.payload.path) {
    return selectSubscribedConnections(connections, message.fileId, message.payload.path, message.payload.args);
  }
  return selectRoomConnections(connections, message.fileId, message.senderEmail);
}
