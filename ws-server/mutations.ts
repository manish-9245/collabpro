/**
 * Query/mutation execution for the standalone WebSocket gateway, extracted
 * out of ws-server/server.ts so it can be unit-tested without a live socket
 * harness (server.ts has side effects at import time — it opens an HTTP
 * server, connects to Redis/RabbitMQ, etc). Dependencies (the prisma client,
 * `queueDbWrite`) are passed in rather than imported at module scope, which
 * is also what makes these testable in isolation.
 */

import {
  asEditorDocument,
  asWhiteboardElements,
  mergeDocumentBlocks,
  mergeWhiteboardPayloads,
  mapConvexIds,
} from '../lib/state-sync-helpers';

export interface MutationPrismaClient {
  file: {
    findUnique: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
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
 * Issue #172 remainder: `queueDbWrite()` was fixed in a prior PR (#180) to
 * return the direct-save promise instead of swallowing it, but the three
 * call sites below must actually `await` it — otherwise a rejected save is
 * never observed here, the case falls through to its `return`, and the
 * caller reports success regardless of whether the write happened. Each
 * `await queueDbWrite(...)` here lets a rejection propagate out of
 * `executeMutation`, to be caught by `runMutation` below (or the caller's
 * own try/catch) and turned into `{ success: false }` for the client.
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

      await queueDbWrite(_id, 'document', document, async () => {
        const file = await prismaClient.file.findUnique({
          where: { id: _id },
          select: { document: true },
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
        return prismaClient.file.update({
          where: { id: _id },
          data: { document: nextValue },
        });
      });

      return { id: _id, document, _id };
    }
    case 'files:updateWhiteboard': {
      const { _id, whiteboard } = args || {};

      await queueDbWrite(_id, 'whiteboard', whiteboard, async () => {
        const file = await prismaClient.file.findUnique({
          where: { id: _id },
          select: { whiteboard: true },
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
        return prismaClient.file.update({
          where: { id: _id },
          data: { whiteboard: nextValue },
        });
      });

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
