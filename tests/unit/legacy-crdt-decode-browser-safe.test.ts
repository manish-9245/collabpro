import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';

// Issue found in review (Group 4): lib/legacy-crdt-decode.ts is imported by
// lib/state-encode.ts, which is imported by Editor.tsx and Canvas.tsx — both
// client components. `Buffer` is a Node.js global; there is no `buffer`
// polyfill dependency and no webpack fallback configured for it, so a
// browser hitting this decode path would throw `Buffer is not defined`.
//
// A plain vitest run (even with `environment: 'jsdom'` in vitest.config.mts)
// does NOT catch this: jsdom only emulates DOM APIs, it runs inside a real
// Node.js process, so Node's global `Buffer` is still present even though a
// real browser would never have it. This test explicitly deletes
// `globalThis.Buffer` for its duration to simulate a real browser, so it
// fails if the implementation still references Buffer anywhere.
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
  // Encoding the fixture itself is allowed to use Buffer (it's test setup,
  // not the production decode path under test) — but restore Buffer before
  // building the base64 string is fine since it runs before Buffer is
  // deleted below.
  return JSON.stringify({ yjs: true, data: Buffer.from(update).toString('base64') });
}

describe('lib/legacy-crdt-decode.ts is browser-safe (no Buffer reference)', () => {
  let originalBuffer: any;

  afterEach(() => {
    (globalThis as any).Buffer = originalBuffer;
  });

  it('decodes a legacy Yjs-wrapped document with globalThis.Buffer deleted (simulated browser)', async () => {
    const legacyState = { time: 1000, blocks: [{ id: 'block-1', type: 'paragraph', data: { text: 'Hello' } }] };
    const stored = (() => {
      // Build the fixture using a JSON-serializable structure compatible
      // with decodeLegacyCrdtState's document-shape expectations.
      const doc = new Y.Doc();
      const map = doc.getMap('state');
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
      setDeep(map, legacyState);
      const update = Y.encodeStateAsUpdate(doc);
      const base64 = Buffer.from(update).toString('base64');
      return JSON.stringify({ yjs: true, data: base64 });
    })();

    originalBuffer = (globalThis as any).Buffer;
    delete (globalThis as any).Buffer;

    // Re-import fresh so any accidental module-scope Buffer usage would also surface.
    const { decodeLegacyCrdtState } = await import('@/lib/legacy-crdt-decode');
    const decoded = decodeLegacyCrdtState(stored, null);

    expect(decoded).toEqual(legacyState);
  });

  it('source of lib/legacy-crdt-decode.ts never calls the Buffer API (comments may still explain why it is avoided)', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const filePath = path.resolve(process.cwd(), 'lib/legacy-crdt-decode.ts');
    const source = await fs.readFile(filePath, 'utf-8');
    // Strip line/block comments before checking for actual Buffer API usage,
    // since the file legitimately documents *why* Buffer is avoided.
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(withoutComments).not.toMatch(/\bBuffer\s*[.(]/);
  });
});
