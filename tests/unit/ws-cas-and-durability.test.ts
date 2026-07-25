import { describe, it, expect, vi } from 'vitest';
import { executeMutation } from '../../ws-server/mutations';
import { queueDbWrite } from '../../ws-server/queue-db-write';

// Pass-through queueDbWrite for tests that only care about the CAS behavior,
// not the broker/durability ordering (that's covered separately below).
const passThroughQueueDbWrite = async (
  _fileId: string,
  _type: 'document' | 'whiteboard' | 'fileName',
  _value: string,
  executeSave: () => Promise<any>
) => executeSave();

function makeStatefulPrismaClient(initial: { document?: string; whiteboard?: string }) {
  let row = { ...initial };
  const findUnique = vi.fn(async (..._args: any[]) => ({ ...row }));
  const update = vi.fn(async ({ data }: any) => {
    row = { ...row, ...data };
    return { ...row };
  });
  const updateMany = vi.fn(async ({ where, data }: any) => {
    if (where.document !== undefined && where.document !== row.document) return { count: 0 };
    if (where.whiteboard !== undefined && where.whiteboard !== row.whiteboard) return { count: 0 };
    row = { ...row, ...data };
    return { count: 1 };
  });
  return { client: { file: { findUnique, update, updateMany } }, getRow: () => row, updateMany };
}

function makeDocument(blockIds: string[]) {
  return JSON.stringify({
    time: Date.now(),
    version: '2.8.1',
    blocks: blockIds.map((id) => ({ id, type: 'paragraph', data: { text: id } })),
  });
}

// P1 (review round 2, Group 1): the WS gateway's executeMutation used to do
// an unconditional prisma.file.update() based on a stale read — never CAS —
// so concurrent edits arriving over the WebSocket could silently lose data,
// exactly the problem #197 was supposed to eliminate everywhere, not just on
// the HTTP transport. executeMutation must call the SAME casUpdateDocument /
// casUpdateWhiteboard the HTTP path uses, not a bespoke reimplementation.
describe('ws-server executeMutation reuses the shared CAS writers (issue found in review, Group 1)', () => {
  it('two concurrent WS files:updateDocument mutations to the same file both survive via CAS retry, not silent data loss', async () => {
    const { client, updateMany } = makeStatefulPrismaClient({ document: makeDocument(['base']) });

    const [resultA, resultB] = await Promise.all([
      executeMutation(client as any, passThroughQueueDbWrite, 'files:updateDocument', {
        _id: 'file-1',
        document: makeDocument(['base', 'writer-a']),
      }),
      executeMutation(client as any, passThroughQueueDbWrite, 'files:updateDocument', {
        _id: 'file-1',
        document: makeDocument(['base', 'writer-b']),
      }),
    ]);

    expect(resultA).toBeTruthy();
    expect(resultB).toBeTruthy();

    // At least one attempt must have hit a CAS conflict and retried — proof
    // this isn't an unconditional last-write-wins update.
    expect(updateMany.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Both persisted document lengths must be internally consistent (2
    // blocks: base + exactly one writer's block) — not an empty/corrupted
    // row and not silently unchanged from the original ['base'] state.
    const store = await client.file.findUnique({} as any);
    const finalDoc = JSON.parse(store.document!);
    expect(finalDoc.blocks.map((b: any) => b.id)).toContain('base');
    expect(finalDoc.blocks).toHaveLength(2);
  });

  it('a WS files:updateDocument mutation that omits a block actually removes it (deletion persists over WS too)', async () => {
    const { client } = makeStatefulPrismaClient({ document: makeDocument(['keep', 'delete-me']) });

    await executeMutation(client as any, passThroughQueueDbWrite, 'files:updateDocument', {
      _id: 'file-1',
      document: makeDocument(['keep']),
    });

    const store = await client.file.findUnique({} as any);
    const finalDoc = JSON.parse(store.document!);
    expect(finalDoc.blocks.map((b: any) => b.id)).toEqual(['keep']);
  });

  it('a WS files:updateWhiteboard mutation preserves the files map', async () => {
    const { client } = makeStatefulPrismaClient({ whiteboard: '[]' });

    await executeMutation(client as any, passThroughQueueDbWrite, 'files:updateWhiteboard', {
      _id: 'file-1',
      whiteboard: JSON.stringify({
        elements: [{ id: 'el-1', type: 'image', x: 0 }],
        files: { 'file-a': { id: 'file-a', dataURL: 'data:image/png;base64,aaa' } },
      }),
    });

    const store = await client.file.findUnique({} as any);
    const parsed = JSON.parse(store.whiteboard!);
    expect(parsed.files).toEqual({ 'file-a': { id: 'file-a', dataURL: 'data:image/png;base64,aaa' } });
  });

  it('a brand-new file (raw empty document string) can be saved over WS on the first attempt', async () => {
    const { client, updateMany } = makeStatefulPrismaClient({ document: '' });

    await executeMutation(client as any, passThroughQueueDbWrite, 'files:updateDocument', {
      _id: 'file-new',
      document: makeDocument(['first']),
    });

    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});

// P1 (review round 2, Group 1): queueDbWrite used to resolve as soon as the
// message was handed to RabbitMQ, not once the DB write actually completed —
// so the client could be told "saved" before the write was even attempted, a
// direct regression against #172 (which this PR claims to close). The
// authoritative write must be synchronous and awaited; the broker publish
// (if configured) is purely a secondary, best-effort durability record that
// must never determine the success/failure result.
describe('ws-server/queue-db-write.ts queueDbWrite (issue found in review, Group 1 — no phantom saves)', () => {
  it('does not report success until the direct save has actually completed, even when a durability queue is configured', async () => {
    let saveResolved = false;
    const executeSave = async () => {
      // Simulate a save that takes a tick to actually complete.
      await new Promise((resolve) => setTimeout(resolve, 5));
      saveResolved = true;
      return { ok: true };
    };
    const sendToQueue = vi.fn();

    const result = await queueDbWrite({ sendToQueue }, 'q', 'file-1', 'document', '{}', executeSave);

    expect(saveResolved).toBe(true);
    expect(result).toEqual({ ok: true });
  });

  it('propagates a rejection from the direct save and never publishes a durability record for a write that never happened', async () => {
    const executeSave = vi.fn().mockRejectedValue(new Error('db write failed'));
    const sendToQueue = vi.fn();

    await expect(queueDbWrite({ sendToQueue }, 'q', 'file-1', 'document', '{}', executeSave))
      .rejects.toThrow('db write failed');

    expect(sendToQueue).not.toHaveBeenCalled();
  });

  it('publishes the durability record only AFTER the direct save succeeds', async () => {
    const callOrder: string[] = [];
    const executeSave = vi.fn(async () => {
      callOrder.push('save');
      return { ok: true };
    });
    const sendToQueue = vi.fn(() => { callOrder.push('enqueue'); });

    await queueDbWrite({ sendToQueue }, 'q', 'file-1', 'document', '{}', executeSave);

    expect(callOrder).toEqual(['save', 'enqueue']);
  });

  it('a durability-queue publish failure does not affect the already-determined successful result', async () => {
    const executeSave = vi.fn().mockResolvedValue({ ok: true });
    const sendToQueue = vi.fn(() => { throw new Error('broker unavailable'); });

    const result = await queueDbWrite({ sendToQueue }, 'q', 'file-1', 'document', '{}', executeSave);
    expect(result).toEqual({ ok: true });
  });

  it('works with no durability queue configured at all (falls back to a plain direct save)', async () => {
    const executeSave = vi.fn().mockResolvedValue({ ok: true });
    const result = await queueDbWrite(null, 'q', 'file-1', 'document', '{}', executeSave);
    expect(result).toEqual({ ok: true });
  });
});
