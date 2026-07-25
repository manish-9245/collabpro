/**
 * Query/mutation execution for the standalone WebSocket gateway, extracted
 * out of ws-server/server.ts so it can be unit-tested without a live socket
 * harness (server.ts has side effects at import time — it opens an HTTP
 * server, connects to Redis/RabbitMQ, etc). Dependencies (the prisma client,
 * `queueDbWrite`) are passed in rather than imported at module scope, which
 * is also what makes these testable in isolation.
 */

import { mapConvexIds } from '../lib/state-sync-helpers';
import { casUpdateDocument, casUpdateWhiteboard } from '../lib/cas-writes';

export interface MutationPrismaClient {
  file: {
    findUnique: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
  };
}

export type QueueDbWrite = (
  fileId: string,
  type: 'document' | 'whiteboard' | 'fileName',
  value: string,
  executeSave: () => Promise<any>
) => Promise<any>;

export async function executeQuery(prismaClient: MutationPrismaClient, path: string, args: any): Promise<any> {
  try {
    switch (path) {
      case 'files:getFileById': {
        const { _id } = args || {};
        const file = await prismaClient.file.findUnique({
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

/**
 * Issue #197 (partial) / #198: reads the file exactly once and returns a
 * ready-to-send `query-update` payload. Previously the mutation handler
 * fetched the file once inside `broadcastQueryUpdateToRoom` for the local
 * broadcast, then fetched it AGAIN immediately after for the Redis publish —
 * this is the single read both now share.
 */
export async function fetchQueryUpdatePayload(
  prismaClient: MutationPrismaClient,
  fileId: string
): Promise<{ data: any; payload: { type: 'query-update'; path: string; args: any; data: any } }> {
  const data = await executeQuery(prismaClient, 'files:getFileById', { _id: fileId });
  return {
    data,
    payload: {
      type: 'query-update',
      path: 'files:getFileById',
      args: { _id: fileId },
      data,
    },
  };
}

/**
 * Issue #172 remainder: `queueDbWrite()` was fixed (see
 * `ws-server/queue-db-write.ts`) to always execute and await the
 * authoritative save before resolving, so a rejection from it propagates out
 * of `executeMutation`, to be caught by `runMutation` below (or the caller's
 * own try/catch) and turned into `{ success: false }` for the client — not
 * reported as success regardless of whether the write happened.
 *
 * Issue found in review round 2 (Group 1): `files:updateDocument` and
 * `files:updateWhiteboard` used to do an unconditional `prisma.file.update`
 * based on a stale read here — never compare-and-swap — so concurrent edits
 * arriving over the WebSocket could silently lose data, the exact problem
 * #197 was supposed to eliminate everywhere, not just on the HTTP transport.
 * They now call the SAME `casUpdateDocument`/`casUpdateWhiteboard` the HTTP
 * path (`app/api/state-sync/services/fileService.ts`) uses, from
 * `lib/cas-writes.ts` — reused, not reimplemented.
 */
export async function executeMutation(
  prismaClient: MutationPrismaClient,
  queueDbWrite: QueueDbWrite,
  path: string,
  args: any
): Promise<any> {
  switch (path) {
    case 'files:updateDocument': {
      const { _id, document } = args || {};

      await queueDbWrite(_id, 'document', document, () =>
        casUpdateDocument(prismaClient, _id, document)
      );

      return { id: _id, document, _id };
    }
    case 'files:updateWhiteboard': {
      const { _id, whiteboard } = args || {};

      await queueDbWrite(_id, 'whiteboard', whiteboard, () =>
        casUpdateWhiteboard(prismaClient, _id, whiteboard)
      );

      return { id: _id, whiteboard, _id };
    }
    case 'files:updateFileName': {
      const { _id, fileName } = args || {};

      await queueDbWrite(_id, 'fileName', fileName, async () => {
        return prismaClient.file.update({
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

/**
 * Runs a mutation and converts the outcome into the `mutation-result`
 * message shape sent back to the client — `success: false` (with the error
 * message) on rejection rather than reporting success regardless (issue
 * #172 remainder).
 */
export async function runMutation(
  executeMutationFn: (path: string, args: any) => Promise<any>,
  path: string,
  args: any
): Promise<{ type: 'mutation-result'; path: string; success: true; data: any } | { type: 'mutation-result'; path: string; success: false; error: string }> {
  try {
    const result = await executeMutationFn(path, args);
    return { type: 'mutation-result', path, success: true, data: result };
  } catch (err: any) {
    return { type: 'mutation-result', path, success: false, error: err?.message || String(err) };
  }
}
