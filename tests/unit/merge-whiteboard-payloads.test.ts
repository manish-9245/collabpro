import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { mergeWhiteboardPayloads } from '@/lib/state-sync-helpers';

// Reproduces the OLD encodeCrdtState() envelope purely as a test fixture, to
// prove rows written before #188 still merge correctly with newly-written
// plain-JSON incoming payloads (no bulk migration script needed — a legacy
// row is naturally migrated to plain JSON the next time it's saved).
function encodeLegacyFixture(elements: any[]): string {
  const doc = new Y.Doc();
  const map = doc.getMap('state');
  const yarray = new Y.Array();
  map.set('elements', yarray);
  yarray.insert(0, elements.map((el) => {
    const m = new Y.Map();
    Object.entries(el).forEach(([k, v]) => m.set(k, v));
    return m;
  }));
  const update = Y.encodeStateAsUpdate(doc);
  return JSON.stringify({ yjs: true, data: Buffer.from(update).toString('base64') });
}

describe('mergeWhiteboardPayloads (issue #188/#189 — plain JSON merge, legacy-read fallback)', () => {
  it('merges two plain-JSON element arrays by id without invoking Yjs', () => {
    const current = JSON.stringify([{ id: 'el-1', type: 'rectangle', x: 0 }]);
    const incoming = JSON.stringify([{ id: 'el-2', type: 'circle', x: 10 }]);

    const merged = JSON.parse(mergeWhiteboardPayloads(current, incoming));
    expect(merged).toHaveLength(2);
    expect(merged.map((e: any) => e.id).sort()).toEqual(['el-1', 'el-2']);
  });

  it('deduplicates by id, incoming wins, when merging identical payloads', () => {
    const current = JSON.stringify([{ id: 'el-1', type: 'rectangle', x: 0 }]);
    const merged = JSON.parse(mergeWhiteboardPayloads(current, current));
    expect(merged).toHaveLength(1);
  });

  it('merges a legacy Yjs-wrapped current row with a plain-JSON incoming payload', () => {
    const legacyCurrent = encodeLegacyFixture([{ id: 'el-1', type: 'rectangle', x: 0 }]);
    const incoming = JSON.stringify([{ id: 'el-2', type: 'circle', x: 10 }]);

    const merged = JSON.parse(mergeWhiteboardPayloads(legacyCurrent, incoming));
    expect(merged.map((e: any) => e.id).sort()).toEqual(['el-1', 'el-2']);
  });
});
