import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { casUpdateDocument, casUpdateWhiteboard } from '@/lib/cas-writes';

function makePrismaClient(initialFile: { document?: string; whiteboard?: string }) {
  let row = { ...initialFile };
  const findUnique = vi.fn(async () => ({ ...row }));
  const updateMany = vi.fn(async ({ where, data }: any) => {
    if (where.document !== undefined && where.document !== row.document) return { count: 0 };
    if (where.whiteboard !== undefined && where.whiteboard !== row.whiteboard) return { count: 0 };
    row = { ...row, ...data };
    return { count: 1 };
  });
  return { client: { file: { findUnique, updateMany } }, getRow: () => row, findUnique, updateMany };
}

function encodeLegacyDocFixture(doc: any): string {
  const yDoc = new Y.Doc();
  const map = yDoc.getMap('state');
  const setDeep = (targetMap: Y.Map<any>, obj: any) => {
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined || value === null) targetMap.set(key, null);
      else if (Array.isArray(value)) {
        const yarray = new Y.Array();
        targetMap.set(key, yarray);
        yarray.insert(0, value.map((item) => {
          if (item && typeof item === 'object') {
            const nestedMap = new Y.Map();
            setDeep(nestedMap, item);
            return nestedMap;
          }
          return item;
        }));
      } else if (typeof value === 'object') {
        const nestedMap = new Y.Map();
        targetMap.set(key, nestedMap);
        setDeep(nestedMap, value as any);
      } else {
        targetMap.set(key, value);
      }
    }
  };
  setDeep(map, doc);
  const update = Y.encodeStateAsUpdate(yDoc);
  return JSON.stringify({ yjs: true, data: Buffer.from(update).toString('base64') });
}

describe('casUpdateDocument (review round 2, Group 1 + Group 2)', () => {
  it('P1: succeeds on the very first save of a brand-new file whose default document is the raw empty string', async () => {
    // A newly created file has `document: ""` in the DB (see
    // files:createFile — `document: document ?? ''`), not a synthesized
    // empty Editor.js document object. The CAS predicate must compare
    // against that exact raw value, or every save on a fresh file conflicts
    // forever.
    const { client, updateMany } = makePrismaClient({ document: '' });

    const result = await casUpdateDocument(client as any, 'file-new', JSON.stringify({
      time: Date.now(),
      version: '2.8.1',
      blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'first save' } }],
    }));

    expect(result.blocks).toHaveLength(1);
    // Must succeed on the first attempt, not exhaust retries.
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('P1: a full-snapshot save with a block removed actually removes it (no ghost content from union-merge)', async () => {
    const initial = JSON.stringify({
      time: 1000,
      version: '2.8.1',
      blocks: [
        { id: 'b1', type: 'paragraph', data: { text: 'one' } },
        { id: 'b2', type: 'paragraph', data: { text: 'two' } },
        { id: 'b3', type: 'paragraph', data: { text: 'three' } },
      ],
    });
    const { client } = makePrismaClient({ document: initial });

    const incoming = JSON.stringify({
      time: 2000,
      version: '2.8.1',
      blocks: [
        { id: 'b1', type: 'paragraph', data: { text: 'one' } },
        { id: 'b3', type: 'paragraph', data: { text: 'three' } },
      ],
    });

    const result = await casUpdateDocument(client as any, 'file-1', incoming);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks.map((b: any) => b.id)).toEqual(['b1', 'b3']);
  });

  it('retries against the fresh row on a genuine CAS conflict and still succeeds', async () => {
    const { client, updateMany } = makePrismaClient({ document: JSON.stringify({ time: 1, blocks: [], version: '2.8.1' }) });
    let calls = 0;
    updateMany.mockImplementationOnce(async () => {
      calls++;
      return { count: 0 };
    });

    const result = await casUpdateDocument(client as any, 'file-1', JSON.stringify({
      time: 2, version: '2.8.1', blocks: [{ id: 'x', type: 'paragraph', data: { text: 'y' } }],
    }));

    expect(result.blocks).toHaveLength(1);
    expect(updateMany.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('P1 (Group 3): a legacy Yjs-wrapped current row does not block the CAS write (predicate only needs the raw string)', async () => {
    const legacyCurrent = encodeLegacyDocFixture({ time: 1, version: '2.8.1', blocks: [{ id: 'legacy-1', type: 'paragraph', data: { text: 'old' } }] });
    const { client, updateMany } = makePrismaClient({ document: legacyCurrent });

    const result = await casUpdateDocument(client as any, 'file-legacy', JSON.stringify({
      time: 2, version: '2.8.1', blocks: [{ id: 'new-1', type: 'paragraph', data: { text: 'new' } }],
    }));

    expect(result.blocks.map((b: any) => b.id)).toEqual(['new-1']);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('casUpdateWhiteboard (review round 2, Group 1 + Group 2)', () => {
  it('P1: succeeds on the very first save of a brand-new file whose default whiteboard is the raw empty string', async () => {
    const { client, updateMany } = makePrismaClient({ whiteboard: '' });

    const result = await casUpdateWhiteboard(client as any, 'file-new', JSON.stringify({
      elements: [{ id: 'el-1', type: 'rectangle', x: 0 }],
      files: {},
    }));

    expect(JSON.parse(result).elements).toHaveLength(1);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('P1: a full-snapshot save with an element removed actually removes it', async () => {
    const initial = JSON.stringify({
      elements: [
        { id: 'el-1', type: 'rectangle', x: 0 },
        { id: 'el-2', type: 'circle', x: 10 },
      ],
      files: {},
    });
    const { client } = makePrismaClient({ whiteboard: initial });

    const incoming = JSON.stringify({ elements: [{ id: 'el-1', type: 'rectangle', x: 0 }], files: {} });
    const result = await casUpdateWhiteboard(client as any, 'file-1', incoming);

    const parsed = JSON.parse(result);
    expect(parsed.elements).toHaveLength(1);
    expect(parsed.elements[0].id).toBe('el-1');
  });

  it('P1: files map survives a full-snapshot whiteboard save', async () => {
    const { client } = makePrismaClient({ whiteboard: '[]' });

    const incoming = JSON.stringify({
      elements: [{ id: 'el-1', type: 'image', x: 0, fileId: 'file-a' }],
      files: { 'file-a': { id: 'file-a', dataURL: 'data:image/png;base64,aaa' } },
    });
    const result = await casUpdateWhiteboard(client as any, 'file-1', incoming);

    const parsed = JSON.parse(result);
    expect(parsed.files).toEqual({ 'file-a': { id: 'file-a', dataURL: 'data:image/png;base64,aaa' } });
  });

  it('P1 (Group 3): a delta update against a legacy Yjs-wrapped current row produces a real merge of old + new, not just the incoming delta alone', async () => {
    const legacyCurrent = (() => {
      const yDoc = new Y.Doc();
      const map = yDoc.getMap('state');
      const yarray = new Y.Array();
      map.set('elements', yarray);
      const m = new Y.Map();
      m.set('id', 'legacy-el-1');
      m.set('type', 'rectangle');
      m.set('x', 0);
      yarray.insert(0, [m]);
      const update = Y.encodeStateAsUpdate(yDoc);
      return JSON.stringify({ yjs: true, data: Buffer.from(update).toString('base64') });
    })();
    const { client } = makePrismaClient({ whiteboard: legacyCurrent });

    const delta = JSON.stringify({
      isDelta: true,
      updated: [{ id: 'new-el-1', type: 'circle', x: 20 }],
      deleted: [],
    });
    const result = await casUpdateWhiteboard(client as any, 'file-legacy', delta);

    const parsed = JSON.parse(result);
    const ids = parsed.elements.map((e: any) => e.id).sort();
    expect(ids).toEqual(['legacy-el-1', 'new-el-1']);
  });

  it('a delta update respects the deleted list against current content', async () => {
    const current = JSON.stringify({
      elements: [
        { id: 'el-1', type: 'rectangle', x: 0 },
        { id: 'el-2', type: 'circle', x: 10 },
      ],
      files: {},
    });
    const { client } = makePrismaClient({ whiteboard: current });

    const delta = JSON.stringify({ isDelta: true, updated: [], deleted: ['el-2'] });
    const result = await casUpdateWhiteboard(client as any, 'file-1', delta);

    const parsed = JSON.parse(result);
    expect(parsed.elements.map((e: any) => e.id)).toEqual(['el-1']);
  });
});
