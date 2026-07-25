import { describe, it, expect, vi } from 'vitest';
import {
  subscriptionKey,
  buildQueryUpdatePayload,
  selectSubscribedConnections,
  selectRoomConnections,
  deliverToConnections,
  selectRecipientsForRedisMessage,
} from '../../ws-server/collab-broadcast';

function makeConn(id: string, rooms: string[], subs: string[] = []) {
  return {
    ws: { send: vi.fn() },
    user: { id },
    joinedRooms: new Set(rooms),
    subscriptions: new Map(subs.map((s) => [s, { path: 'files:getFileById', args: {} }])),
  };
}

describe('ws-server/collab-broadcast (issue #197 partial — single code path, local + cross-replica)', () => {
  it('subscriptionKey matches the key format used for subscribe/unsubscribe', () => {
    expect(subscriptionKey('files:getFileById', { _id: 'file-1' })).toBe(
      'files:getFileById:{"_id":"file-1"}'
    );
  });

  it('selectSubscribedConnections only returns connections joined to the room AND subscribed to that exact query', () => {
    const key = subscriptionKey('files:getFileById', { _id: 'file-1' });
    const subscribed = makeConn('a', ['file-1'], [key]);
    const joinedNotSubscribed = makeConn('b', ['file-1'], []);
    const subscribedDifferentRoom = makeConn('c', ['file-2'], [key]);

    const result = selectSubscribedConnections(
      [subscribed, joinedNotSubscribed, subscribedDifferentRoom],
      'file-1',
      'files:getFileById',
      { _id: 'file-1' }
    );

    expect(result).toEqual([subscribed]);
  });

  it('selectRoomConnections returns everyone in the room except the excluded sender', () => {
    const a = makeConn('a', ['file-1']);
    const b = makeConn('b', ['file-1']);
    const c = makeConn('c', ['file-2']);

    const result = selectRoomConnections([a, b, c], 'file-1', 'a');
    expect(result).toEqual([b]);
  });

  it('deliverToConnections sends the same JSON payload to every selected connection and returns the count', () => {
    const a = makeConn('a', ['file-1']);
    const b = makeConn('b', ['file-1']);
    const payload = buildQueryUpdatePayload('files:getFileById', { _id: 'file-1' }, { fileName: 'doc' });

    const count = deliverToConnections([a, b], payload);

    expect(count).toBe(2);
    expect(a.ws.send).toHaveBeenCalledWith(JSON.stringify(payload));
    expect(b.ws.send).toHaveBeenCalledWith(JSON.stringify(payload));
  });

  it('deliverToConnections skips a connection whose send() throws (closed socket) instead of aborting the whole fan-out', () => {
    const a = makeConn('a', ['file-1']);
    const b = makeConn('b', ['file-1']);
    const c = makeConn('c', ['file-1']);
    (b.ws.send as any).mockImplementation(() => {
      throw new Error('WebSocket is not open: readyState 3 (CLOSED)');
    });
    const payload = buildQueryUpdatePayload('files:getFileById', { _id: 'file-1' }, { fileName: 'doc' });

    const count = deliverToConnections([a, b, c], payload);

    expect(count).toBe(2);
    expect(a.ws.send).toHaveBeenCalledWith(JSON.stringify(payload));
    expect(c.ws.send).toHaveBeenCalledWith(JSON.stringify(payload));
  });

  describe('selectRecipientsForRedisMessage — cross-replica fan-out routing', () => {
    it('routes a query-update message through subscription matching, like the local broadcast path', () => {
      const key = subscriptionKey('files:getFileById', { _id: 'file-1' });
      const subscribed = makeConn('a', ['file-1'], [key]);
      const joinedNotSubscribed = makeConn('b', ['file-1'], []);

      const result = selectRecipientsForRedisMessage([subscribed, joinedNotSubscribed], {
        fileId: 'file-1',
        senderEmail: 'someone-else@test.com',
        payload: { type: 'query-update', path: 'files:getFileById', args: { _id: 'file-1' } },
      });

      expect(result).toEqual([subscribed]);
    });

    it('routes a cursor-update message to every room member except the sender, as before', () => {
      const a = makeConn('a', ['file-1']);
      const b = makeConn('b', ['file-1']);

      const result = selectRecipientsForRedisMessage([a, b], {
        fileId: 'file-1',
        senderEmail: 'a',
        payload: { type: 'cursor-update' },
      });

      expect(result).toEqual([b]);
    });
  });
});
