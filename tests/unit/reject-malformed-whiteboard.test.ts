import { describe, it, expect, vi } from 'vitest';
import { casUpdateWhiteboard } from '@/lib/cas-writes';
import { mergeWhiteboardPayloads } from '@/lib/state-sync-helpers';

// Group 5 (review round 2): malformed whiteboard input must not be silently
// persisted or allowed to wipe existing content. The CAS write path must
// reject (throw, so the client sees a failed mutation) rather than either
// (a) passing the raw invalid string straight through to storage, or worse,
// (b) silently replacing the whiteboard with an empty payload.
function makePrismaClient(initial: { whiteboard?: string }) {
  let row = { ...initial };
  const findUnique = vi.fn(async () => ({ ...row }));
  const updateMany = vi.fn(async ({ data }: any) => {
    row = { ...row, ...data };
    return { count: 1 };
  });
  return { client: { file: { findUnique, updateMany } }, getRow: () => row, updateMany };
}

describe('casUpdateWhiteboard rejects malformed incoming payloads (issue found in review, Group 5)', () => {
  it('throws rather than wiping an existing whiteboard to empty when incoming is unparseable garbage', async () => {
    const existing = JSON.stringify({ elements: [{ id: 'el-1', type: 'rectangle', x: 0 }], files: {} });
    const { client, updateMany } = makePrismaClient({ whiteboard: existing });

    await expect(
      casUpdateWhiteboard(client as any, 'file-1', 'not valid json at all {{{')
    ).rejects.toThrow();

    // Must not have persisted anything — existing content survives untouched.
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('mergeWhiteboardPayloads rejects malformed incoming payloads instead of passing them through raw', () => {
  it('throws rather than returning the raw invalid incoming string', () => {
    const current = JSON.stringify({ elements: [{ id: 'el-1', type: 'rectangle', x: 0 }], files: {} });
    expect(() => mergeWhiteboardPayloads(current, 'not valid json at all {{{')).toThrow();
  });
});
