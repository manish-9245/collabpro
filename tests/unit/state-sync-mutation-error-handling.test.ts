import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wsClient, useMutation, api } from '@/lib/state-sync/react';

/**
 * Regression coverage for a real correctness bug found via a live 403 on
 * files:upsertPresence (a presence heartbeat) spamming the Next.js dev
 * console forever: wsClient.mutation()'s HTTP fallback treated EVERY
 * failure - including a definitive 4xx like 403 Forbidden - as a transient
 * connectivity blip, queuing it into the IndexedDB offline-retry queue and
 * optimistically resolving as if it succeeded. That meant a 403'd mutation
 * (any mutation, not just presence) silently appeared to succeed to its
 * caller, and got retried forever on every reconnect. A 4xx is the server
 * definitively rejecting the request as given - retrying identical args
 * can never succeed, unlike a real network blip.
 */

const mockFetch = vi.fn();

function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

describe('lib/state-sync/react - mutation error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
    // jsdom's default test URL doesn't match /workspace/:id, so wsClient
    // never auto-connects a real WebSocket - mutation() falls straight to
    // the HTTP path being tested here, no WS mocking needed.
    expect(wsClient!.getStatus()).toBe('disconnected');
  });

  describe('wsClient.mutation (HTTP fallback)', () => {
    it('rejects on a 403 instead of silently queuing it and resolving as if it succeeded', async () => {
      mockFetch.mockResolvedValueOnce(jsonRes(403, { error: 'Forbidden: You do not have access to this file' }));

      await expect(wsClient!.mutation('files:upsertPresence', { fileId: 'f1' })).rejects.toMatchObject({
        status: 403,
        message: expect.stringContaining('Forbidden'),
      });
    });

    it('rejects on a 400/404 the same way (any definitive 4xx, not just 403)', async () => {
      mockFetch.mockResolvedValueOnce(jsonRes(404, { error: 'Not Found' }));
      await expect(wsClient!.mutation('files:updateDocument', { fileId: 'missing' })).rejects.toMatchObject({ status: 404 });
    });

    it('still queues offline and optimistically resolves on a genuine network failure (fetch throws)', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const args = { fileId: 'f1', userEmail: 'dev@collabpro.com' };
      const result = await wsClient!.mutation('files:upsertPresence', args, 'f1');
      // Optimistic resolve preserved for real connectivity blips - this is
      // the one case the offline queue was actually designed for.
      expect(result).toEqual(args);
    });

    it('still queues offline and optimistically resolves on a 5xx (server error, potentially transient)', async () => {
      mockFetch.mockResolvedValueOnce(jsonRes(500, { error: 'Internal Server Error' }));
      const args = { fileId: 'f1' };
      const result = await wsClient!.mutation('files:updateDocument', args, 'f1');
      expect(result).toEqual(args);
    });
  });

  describe('useMutation', () => {
    it('propagates a 403 rejection to the caller instead of resolving successfully', async () => {
      mockFetch.mockResolvedValueOnce(jsonRes(403, { error: 'Forbidden: You do not have access to this file' }));
      const upsertPresence = useMutation(api.files.upsertPresence);
      await expect(upsertPresence({ fileId: 'f1' })).rejects.toMatchObject({ status: 403 });
    });
  });
});
