import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { decodeLegacyCrdtState } from '@/lib/legacy-crdt-decode';

// Helper that reproduces the OLD encodeCrdtState() behavior (removed as part of
// issue #188) purely for test fixture purposes, so we can assert the legacy
// decode path still reads rows written before the migration to plain JSON.
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

describe('decodeLegacyCrdtState (issue #188 backward-compat read path)', () => {
  it('decodes a document stored in the old {yjs:true,data:...} format', () => {
    const legacyState = {
      time: 1000,
      version: '2.8.1',
      blocks: [{ id: 'block-1', type: 'paragraph', data: { text: 'Hello' } }],
    };
    const stored = encodeLegacyFixture(legacyState);

    const decoded = decodeLegacyCrdtState(stored, null);
    expect(decoded).toEqual(legacyState);
  });

  it('decodes a Y.Array property fully (e.g. points itself) but leaves each array-typed ITEM within it as a numeric-keyed object', () => {
    // `points` itself is a direct property value, which the old encoder
    // always gave a real Y.Array - that decodes back to a real array fine.
    // But each [x, y] pair WITHIN points is an array-typed ITEM of that
    // array, the one shape the old encoder's item-wrapping logic couldn't
    // represent unambiguously (it wraps any object-typed item, including a
    // nested array, in a Y.Map using numeric-string keys). That shape is
    // indistinguishable here from a genuine object whose keys happen to be
    // numeric strings, so this generic decoder deliberately does not guess.
    // Schema-aware callers recover it themselves (see
    // coerceNumericKeyedArray in lib/state-sync-helpers.ts, used
    // specifically for Excalidraw's `points`).
    const legacyState = {
      elements: [
        { id: 'el-1', type: 'line', points: [[0, 0], [10, 20]] },
      ],
    };
    const stored = encodeLegacyFixture(legacyState);

    const decoded = decodeLegacyCrdtState(stored, null);
    expect(Array.isArray(decoded.elements[0].points)).toBe(true);
    expect(decoded.elements[0].points).toEqual([{ '0': 0, '1': 0 }, { '0': 10, '1': 20 }]);
  });

  it('does not coerce a genuine object with numeric-string keys into an array', () => {
    const legacyState = {
      lookup: { '0': 'zero', '1': 'one' },
    };
    const stored = encodeLegacyFixture(legacyState);

    const decoded = decodeLegacyCrdtState(stored, null);
    expect(decoded).toEqual(legacyState);
    expect(Array.isArray(decoded.lookup)).toBe(false);
  });

  it('falls back to the parsed value when the payload is plain JSON, not yjs-wrapped', () => {
    const plain = { time: 1000, blocks: [] };
    const stored = JSON.stringify(plain);

    const decoded = decodeLegacyCrdtState(stored, null);
    expect(decoded).toEqual(plain);
  });

  it('returns the fallback default for null/undefined input', () => {
    expect(decodeLegacyCrdtState(null, { empty: true })).toEqual({ empty: true });
    expect(decodeLegacyCrdtState(undefined, { empty: true })).toEqual({ empty: true });
  });
});
