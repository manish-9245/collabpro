import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { asEditorDocument, asWhiteboardElements, asWhiteboardPayload } from '@/lib/state-sync-helpers';

// Group 3 (review round 2): asEditorDocument/asWhiteboardElements used to see
// the legacy `{yjs:true,data:...}` envelope, not recognize it as valid
// content (no `.blocks` array / not an elements array), and throw — instead
// of decoding it via lib/legacy-crdt-decode.ts first. That meant (1) any CAS
// write path that parses "current" for a legacy row failed outright, so it
// could never actually get migrated, and (2) callers that caught the throw
// and fell back to "just use the incoming payload" silently destroyed the
// user's existing legacy content. Every merge/normalize entry point must
// attempt the legacy decode FIRST, before giving up.

function encodeLegacyDocFixture(doc: any): string {
  const yDoc = new Y.Doc();
  const map = yDoc.getMap('state');
  const setDeep = (targetMap: Y.Map<any>, obj: any) => {
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined || value === null) {
        targetMap.set(key, null);
      } else if (Array.isArray(value)) {
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

function encodeLegacyArrayFixture(elements: any[]): string {
  const yDoc = new Y.Doc();
  const map = yDoc.getMap('state');
  const yarray = new Y.Array();
  map.set('elements', yarray);
  yarray.insert(0, elements.map((el) => {
    const m = new Y.Map();
    Object.entries(el).forEach(([k, v]) => m.set(k, v));
    return m;
  }));
  const update = Y.encodeStateAsUpdate(yDoc);
  return JSON.stringify({ yjs: true, data: Buffer.from(update).toString('base64') });
}

describe('asEditorDocument decodes legacy Yjs rows instead of throwing', () => {
  it('decodes a legacy-format document into its real blocks, not an error', () => {
    const legacyDoc = { time: 1000, version: '2.8.1', blocks: [{ id: 'legacy-1', type: 'paragraph', data: { text: 'Old content' } }] };
    const stored = encodeLegacyDocFixture(legacyDoc);

    const result = asEditorDocument(stored);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].id).toBe('legacy-1');
  });
});

describe('asWhiteboardElements decodes legacy Yjs rows instead of throwing/returning garbage', () => {
  it('decodes legacy-format whiteboard elements', () => {
    const stored = encodeLegacyArrayFixture([{ id: 'legacy-el-1', type: 'rectangle', x: 10 }]);
    const result = asWhiteboardElements(stored);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('legacy-el-1');
  });
});

describe('asWhiteboardPayload decodes legacy Yjs rows and preserves files where present', () => {
  it('decodes a legacy-format whiteboard into elements', () => {
    const stored = encodeLegacyArrayFixture([{ id: 'legacy-el-1', type: 'rectangle', x: 10 }]);
    const result = asWhiteboardPayload(stored);
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0].id).toBe('legacy-el-1');
    expect(result.files).toEqual({});
  });

  it('extracts both elements and files from a current-format payload', () => {
    const payload = JSON.stringify({
      elements: [{ id: 'el-1', type: 'image', x: 0 }],
      files: { 'file-abc': { id: 'file-abc', dataURL: 'data:image/png;base64,xyz' } },
    });
    const result = asWhiteboardPayload(payload);
    expect(result.elements).toHaveLength(1);
    expect(result.files).toEqual({ 'file-abc': { id: 'file-abc', dataURL: 'data:image/png;base64,xyz' } });
  });
});
