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
