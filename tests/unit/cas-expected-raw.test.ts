import { describe, it, expect } from 'vitest';
import { casUpdateDocument, casUpdateWhiteboard, CasConflictError } from '@/lib/cas-writes';

// A file row that another writer can change between our read and our write.
function racyDb(initial: { document: string; whiteboard: string }, interleave?: (row: { document: string; whiteboard: string }) => void) {
  const row = { ...initial };
  let reads = 0;
  return {
    row,
    file: {
      findUnique: async () => {
        const snapshot = { ...row };
        if (reads++ === 0) interleave?.(row); // a human edit lands right after our first read
        return snapshot;
      },
      updateMany: async ({ where, data }: any) => {
        const matches = (where.document === undefined || where.document === row.document) && (where.whiteboard === undefined || where.whiteboard === row.whiteboard);
        if (!matches) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
  };
}

describe('expectedRaw (atomic baseVersion)', () => {
  it('document: an edit that lands between read and write is a conflict, not an overwrite', async () => {
    const db = racyDb({ document: '{"blocks":[1]}', whiteboard: '' }, (r) => { r.document = '{"blocks":[2]}'; });
    await expect(casUpdateDocument(db as any, 'f', { blocks: [] }, { expectedRaw: '{"blocks":[1]}' })).rejects.toBeInstanceOf(CasConflictError);
    expect(db.row.document).toBe('{"blocks":[2]}'); // the human edit survived
  });
  it('whiteboard: same guarantee, including replaceAll-style full writes', async () => {
    const db = racyDb({ document: '', whiteboard: '{"elements":[1]}' }, (r) => { r.whiteboard = '{"elements":[2]}'; });
    await expect(casUpdateWhiteboard(db as any, 'f', [{ id: 'a', type: 'rectangle' }], { expectedRaw: '{"elements":[1]}' })).rejects.toBeInstanceOf(CasConflictError);
    expect(db.row.whiteboard).toBe('{"elements":[2]}');
  });
  it('without expectedRaw the existing last-writer-wins retry behavior is unchanged', async () => {
    const db = racyDb({ document: '{"blocks":[1]}', whiteboard: '' }, (r) => { r.document = '{"blocks":[2]}'; });
    await casUpdateDocument(db as any, 'f', { blocks: [] });
    expect(JSON.parse(db.row.document).blocks).toEqual([]);
  });
  it('matching expectedRaw writes normally', async () => {
    const db = racyDb({ document: '{"blocks":[1]}', whiteboard: '' });
    await casUpdateDocument(db as any, 'f', { blocks: [] }, { expectedRaw: '{"blocks":[1]}' });
    expect(JSON.parse(db.row.document).blocks).toEqual([]);
  });
});
