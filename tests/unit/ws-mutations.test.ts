import { describe, it, expect, vi } from 'vitest';
import {
  executeMutation,
  executeQuery,
  fetchQueryUpdatePayload,
  runMutation,
} from '../../ws-server/mutations';

// Issue #172 remainder: a prior PR fixed queueDbWrite() to return the
// direct-save promise instead of swallowing it, but the WS mutation handler
// still needs to actually `await` it and let a rejection reach the client as
// `{ success: false }` rather than reporting success immediately regardless
// of whether the save succeeded.
describe('ws-server/mutations executeMutation (issue #172 remainder — await propagation)', () => {
  const basePrisma = () => ({
    file: {
      findUnique: vi.fn().mockResolvedValue({ document: '{"blocks":[]}', whiteboard: '[]' }),
      update: vi.fn(),
    },
  });

  it('propagates a rejection from queueDbWrite for files:updateDocument', async () => {
    const prismaClient = basePrisma();
    const failingQueueDbWrite = vi.fn().mockRejectedValue(new Error('db write failed'));

    await expect(
      executeMutation(prismaClient as any, failingQueueDbWrite, 'files:updateDocument', {
        _id: 'file-1',
        document: '{"blocks":[]}',
      })
    ).rejects.toThrow('db write failed');
    expect(failingQueueDbWrite).toHaveBeenCalled();
  });

  it('propagates a rejection from queueDbWrite for files:updateWhiteboard', async () => {
    const prismaClient = basePrisma();
    const failingQueueDbWrite = vi.fn().mockRejectedValue(new Error('db write failed'));

    await expect(
      executeMutation(prismaClient as any, failingQueueDbWrite, 'files:updateWhiteboard', {
        _id: 'file-1',
        whiteboard: '[]',
      })
    ).rejects.toThrow('db write failed');
  });

  it('propagates a rejection from queueDbWrite for files:updateFileName', async () => {
    const prismaClient = basePrisma();
    const failingQueueDbWrite = vi.fn().mockRejectedValue(new Error('db write failed'));

    await expect(
      executeMutation(prismaClient as any, failingQueueDbWrite, 'files:updateFileName', {
        _id: 'file-1',
        fileName: 'renamed.txt',
      })
    ).rejects.toThrow('db write failed');
  });

  it('resolves normally when queueDbWrite succeeds', async () => {
    const prismaClient = basePrisma();
    const succeedingQueueDbWrite = vi.fn().mockResolvedValue({ id: 'file-1' });

    const result = await executeMutation(prismaClient as any, succeedingQueueDbWrite, 'files:updateDocument', {
      _id: 'file-1',
      document: '{"blocks":[]}',
    });
    expect(result._id).toBe('file-1');
  });

  it('returns the CAS-canonical saved value, not the raw request body, when they differ', async () => {
    const prismaClient = basePrisma();
    // Simulates casUpdateDocument/casUpdateWhiteboard reconciling the write
    // against concurrent changes: what actually lands can differ from what
    // this client sent. The response must reflect that, not just echo back
    // the request.
    const queueDbWrite = vi.fn().mockResolvedValue({ blocks: [{ id: 'merged-block' }] });

    const docResult = await executeMutation(prismaClient as any, queueDbWrite, 'files:updateDocument', {
      _id: 'file-1',
      document: '{"blocks":[]}',
    });
    expect(docResult.document).toEqual({ blocks: [{ id: 'merged-block' }] });

    const wbQueueDbWrite = vi.fn().mockResolvedValue('{"elements":[{"id":"merged-el"}],"files":{}}');
    const wbResult = await executeMutation(prismaClient as any, wbQueueDbWrite, 'files:updateWhiteboard', {
      _id: 'file-1',
      whiteboard: '[]',
    });
    expect(wbResult.whiteboard).toBe('{"elements":[{"id":"merged-el"}],"files":{}}');
  });
});

describe('runMutation (client sees success:false on save failure, issue #172 remainder)', () => {
  it('sends a mutation-result with success:false when the save rejects, not success:true', async () => {
    const failingExecute = vi.fn().mockRejectedValue(new Error('db write failed'));

    const message = await runMutation(failingExecute, 'files:updateDocument', { _id: 'file-1' });

    expect(message).toEqual({
      type: 'mutation-result',
      path: 'files:updateDocument',
      success: false,
      error: 'db write failed',
    });
  });

  it('sends a mutation-result with success:true and the data when the save resolves', async () => {
    const succeedingExecute = vi.fn().mockResolvedValue({ _id: 'file-1', document: '{}' });

    const message = await runMutation(succeedingExecute, 'files:updateDocument', { _id: 'file-1' });

    expect(message).toEqual({
      type: 'mutation-result',
      path: 'files:updateDocument',
      success: true,
      data: { _id: 'file-1', document: '{}' },
    });
  });
});

// Issue #198 (mutation handler double-read) — the mutation handler used to
// read the full file once inside broadcastQueryUpdateToRoom and again
// immediately after for the Redis publish. fetchQueryUpdatePayload reads
// once and its result is reused for both.
describe('fetchQueryUpdatePayload (issue #198 — read once, reuse for local + Redis)', () => {
  it('reads the file exactly once and returns a ready-to-send query-update payload', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'file-1', fileName: 'doc.txt' });
    const prismaClient = { file: { findUnique, update: vi.fn() } };

    const result = await fetchQueryUpdatePayload(prismaClient as any, 'file-1');

    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(result.payload.type).toBe('query-update');
    expect(result.payload.path).toBe('files:getFileById');
    expect(result.payload.args).toEqual({ _id: 'file-1' });
    expect(result.payload.data._id).toBe('file-1');
  });
});

describe('executeQuery (issue #189 — shared with the mapConvexIds/state-sync-helpers consolidation)', () => {
  it('maps the prisma id field to _id via the canonical mapConvexIds', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'file-1', fileName: 'doc.txt' });
    const prismaClient = { file: { findUnique, update: vi.fn() } };

    const result = await executeQuery(prismaClient as any, 'files:getFileById', { _id: 'file-1' });
    expect(result._id).toBe('file-1');
  });

  it('propagates a DB read failure instead of returning null, so callers cannot mistake it for a legitimate not-found', async () => {
    const findUnique = vi.fn().mockRejectedValue(new Error('connection reset'));
    const prismaClient = { file: { findUnique, update: vi.fn() } };

    await expect(
      executeQuery(prismaClient as any, 'files:getFileById', { _id: 'file-1' })
    ).rejects.toThrow('connection reset');
  });
});
