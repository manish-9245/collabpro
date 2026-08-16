import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { decodeLegacyCrdtState } from '@/lib/legacy-crdt-decode';
import { migrateLegacyCrdtRows } from '@/scripts/migrate-legacy-crdt';

// Same legacy-fixture builder used by tests/unit/legacy-crdt-decode.test.ts —
// reproduces the OLD encodeCrdtState() (removed in #188) shape so the test
// exercises the real decode path, not a fake.
function encodeLegacyFixture(state: any): string {
  const doc = new Y.Doc();
  const map = doc.getMap('state');

  const setDeep = (targetMap: Y.Map<any>, obj: any) => {
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined || value === null) {
        targetMap.set(key, null);
      } else if (Array.isArray(value)) {
        const yarray = new Y.Array();
        targetMap.set(key, yarray);
        const convertedArray = value.map((item) => {
          if (item && typeof item === 'object') {
            const nestedMap = new Y.Map();
            setDeep(nestedMap, item);
            return nestedMap;
          }
          return item;
        });
        yarray.insert(0, convertedArray);
      } else if (typeof value === 'object') {
        const nestedMap = new Y.Map();
        targetMap.set(key, nestedMap);
        setDeep(nestedMap, value as any);
      } else {
        targetMap.set(key, value);
      }
    }
  };

  setDeep(map, state);
  const update = Y.encodeStateAsUpdate(doc);
  const base64 = Buffer.from(update).toString('base64');
  return JSON.stringify({ yjs: true, data: base64 });
}

const legacyDoc = { time: 1000, blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'hi' } }] };
const legacyWhiteboard = { elements: [{ id: 'el-1', type: 'rectangle', x: 0 }] };

function makePrismaMock(rows: any[]) {
  return {
    file: {
      findMany: vi.fn().mockResolvedValue(rows),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

describe('migrateLegacyCrdtRows (issue #242 backfill)', () => {
  it('migrates a fully-legacy row (both document and whiteboard wrapped)', async () => {
    const rows = [
      { id: 'row-both', document: encodeLegacyFixture(legacyDoc), whiteboard: encodeLegacyFixture(legacyWhiteboard) },
    ];
    const prismaMock = makePrismaMock(rows);

    const summary = await migrateLegacyCrdtRows(prismaMock as any);

    expect(prismaMock.file.update).toHaveBeenCalledTimes(1);
    const call = prismaMock.file.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'row-both' });
    expect(JSON.parse(call.data.document)).toEqual(decodeLegacyCrdtState(encodeLegacyFixture(legacyDoc), {}));
    expect(JSON.parse(call.data.whiteboard)).toEqual(decodeLegacyCrdtState(encodeLegacyFixture(legacyWhiteboard), []));

    expect(summary.scanned).toBe(1);
    expect(summary.documentsMigrated).toBe(1);
    expect(summary.whiteboardsMigrated).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it('migrates a partially-legacy row (only document wrapped, whiteboard already plain)', async () => {
    const plainWhiteboard = JSON.stringify([{ id: 'el-2', type: 'ellipse' }]);
    const rows = [
      { id: 'row-doc-only', document: encodeLegacyFixture(legacyDoc), whiteboard: plainWhiteboard },
    ];
    const prismaMock = makePrismaMock(rows);

    const summary = await migrateLegacyCrdtRows(prismaMock as any);

    expect(prismaMock.file.update).toHaveBeenCalledTimes(1);
    const call = prismaMock.file.update.mock.calls[0][0];
    expect(call.data).toHaveProperty('document');
    expect(call.data).not.toHaveProperty('whiteboard');

    expect(summary.documentsMigrated).toBe(1);
    expect(summary.whiteboardsMigrated).toBe(0);
  });

  it('migrates a partially-legacy row (only whiteboard wrapped, document already plain)', async () => {
    const plainDoc = JSON.stringify({ time: 1, blocks: [] });
    const rows = [
      { id: 'row-wb-only', document: plainDoc, whiteboard: encodeLegacyFixture(legacyWhiteboard) },
    ];
    const prismaMock = makePrismaMock(rows);

    const summary = await migrateLegacyCrdtRows(prismaMock as any);

    expect(prismaMock.file.update).toHaveBeenCalledTimes(1);
    const call = prismaMock.file.update.mock.calls[0][0];
    expect(call.data).not.toHaveProperty('document');
    expect(call.data).toHaveProperty('whiteboard');

    expect(summary.documentsMigrated).toBe(0);
    expect(summary.whiteboardsMigrated).toBe(1);
  });

  it('leaves an already-plain-JSON row untouched (no update call at all)', async () => {
    const rows = [
      { id: 'row-plain', document: JSON.stringify({ time: 1, blocks: [] }), whiteboard: JSON.stringify([]) },
    ];
    const prismaMock = makePrismaMock(rows);

    const summary = await migrateLegacyCrdtRows(prismaMock as any);

    expect(prismaMock.file.update).not.toHaveBeenCalled();
    expect(summary.scanned).toBe(1);
    expect(summary.documentsMigrated).toBe(0);
    expect(summary.whiteboardsMigrated).toBe(0);
  });

  it('skips rows with null/empty document and whiteboard without crashing', async () => {
    const rows = [
      { id: 'row-empty', document: '', whiteboard: null },
    ];
    const prismaMock = makePrismaMock(rows);

    const summary = await migrateLegacyCrdtRows(prismaMock as any);

    expect(prismaMock.file.update).not.toHaveBeenCalled();
    expect(summary.scanned).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it('does not abort the whole run when one row fails to update — logs and continues', async () => {
    const rows = [
      { id: 'row-fails', document: encodeLegacyFixture(legacyDoc), whiteboard: '' },
      { id: 'row-ok', document: encodeLegacyFixture(legacyDoc), whiteboard: '' },
    ];
    const prismaMock = makePrismaMock(rows);
    prismaMock.file.update.mockImplementationOnce(() => Promise.reject(new Error('db write failed')));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const summary = await migrateLegacyCrdtRows(prismaMock as any);

    expect(prismaMock.file.update).toHaveBeenCalledTimes(2);
    expect(summary.scanned).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.documentsMigrated).toBe(1); // only the successful one counted
    errSpy.mockRestore();
  });

  it('computes correct summary counts across a mixed batch', async () => {
    const rows = [
      { id: 'r1', document: encodeLegacyFixture(legacyDoc), whiteboard: encodeLegacyFixture(legacyWhiteboard) },
      { id: 'r2', document: JSON.stringify({ time: 1, blocks: [] }), whiteboard: JSON.stringify([]) },
      { id: 'r3', document: '', whiteboard: '' },
      { id: 'r4', document: encodeLegacyFixture(legacyDoc), whiteboard: JSON.stringify([]) },
    ];
    const prismaMock = makePrismaMock(rows);

    const summary = await migrateLegacyCrdtRows(prismaMock as any);

    expect(summary.scanned).toBe(4);
    expect(summary.documentsMigrated).toBe(2); // r1, r4
    expect(summary.whiteboardsMigrated).toBe(1); // r1
    expect(summary.failed).toBe(0);
    expect(prismaMock.file.update).toHaveBeenCalledTimes(2); // r1, r4
  });

  // Regression test (CodeRabbit finding on PR #243): a row whose legacy blob
  // is genuinely corrupted (bad Y.Doc update bytes) must NOT have its field
  // overwritten with the empty fallback default — that would silently
  // destroy the user's real content and still count as "migrated". A
  // decode failure must be skipped and counted as `failed`, leaving the
  // row's still-legacy-but-still-readable value untouched.
  it('does not overwrite a field with the empty fallback when its legacy blob fails to decode — counts it as failed instead', async () => {
    // yjs-shaped envelope (passes isLegacyYjsPayload) but `data` is not a
    // valid Yjs update, so Y.applyUpdate throws.
    const corruptDocument = JSON.stringify({ yjs: true, data: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 255, 254, 253]).toString('base64') });
    const rows = [
      // Corrupted document, but a genuinely valid legacy whiteboard on the
      // same row — proves the corrupted field is excluded from the update
      // payload while the sibling valid field still migrates.
      { id: 'row-corrupt-doc', document: corruptDocument, whiteboard: encodeLegacyFixture(legacyWhiteboard) },
    ];
    const prismaMock = makePrismaMock(rows);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const summary = await migrateLegacyCrdtRows(prismaMock as any);

    expect(prismaMock.file.update).toHaveBeenCalledTimes(1);
    const call = prismaMock.file.update.mock.calls[0][0];
    // The corrupted field must be entirely absent from the write, not
    // present with an empty-fallback value.
    expect(call.data).not.toHaveProperty('document');
    expect(call.data).toHaveProperty('whiteboard');

    expect(summary.failed).toBe(1);
    expect(summary.documentsMigrated).toBe(0);
    expect(summary.whiteboardsMigrated).toBe(1);
    errSpy.mockRestore();
  });

  it('when EVERY field on a row fails to decode, does not call update at all (nothing to write)', async () => {
    const corruptDocument = JSON.stringify({ yjs: true, data: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 255, 254, 253]).toString('base64') });
    const rows = [
      { id: 'row-all-corrupt', document: corruptDocument, whiteboard: corruptDocument },
    ];
    const prismaMock = makePrismaMock(rows);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const summary = await migrateLegacyCrdtRows(prismaMock as any);

    expect(prismaMock.file.update).not.toHaveBeenCalled();
    expect(summary.failed).toBe(2);
    expect(summary.documentsMigrated).toBe(0);
    expect(summary.whiteboardsMigrated).toBe(0);
    errSpy.mockRestore();
  });
});

describe('main() (CLI entrypoint exit code)', () => {
  beforeEach(() => {
    vi.resetModules();
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('sets process.exitCode = 1 when the run has any failed rows', async () => {
    vi.doMock('@/lib/db', () => ({
      prisma: {
        file: {
          findMany: vi.fn().mockResolvedValue([{ id: 'row-fails', document: encodeLegacyFixture(legacyDoc), whiteboard: '' }]),
          update: vi.fn().mockRejectedValue(new Error('db write failed')),
        },
        $disconnect: vi.fn(),
      },
    }));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const mod = await import('@/scripts/migrate-legacy-crdt');
    await mod.main();

    expect(process.exitCode).toBe(1);
    errSpy.mockRestore();
    logSpy.mockRestore();
    vi.doUnmock('@/lib/db');
  });

  it('leaves process.exitCode unset when every row migrates cleanly', async () => {
    vi.doMock('@/lib/db', () => ({
      prisma: {
        file: {
          findMany: vi.fn().mockResolvedValue([{ id: 'row-ok', document: encodeLegacyFixture(legacyDoc), whiteboard: '' }]),
          update: vi.fn().mockResolvedValue({}),
        },
        $disconnect: vi.fn(),
      },
    }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const mod = await import('@/scripts/migrate-legacy-crdt');
    await mod.main();

    expect(process.exitCode).toBeUndefined();
    logSpy.mockRestore();
    vi.doUnmock('@/lib/db');
  });
});
