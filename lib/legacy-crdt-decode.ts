import * as Y from 'yjs';

/**
 * Decodes a standard base64 string into raw bytes without relying on Node's
 * `Buffer` global.
 *
 * `lib/legacy-crdt-decode.ts` is imported (via `lib/state-encode.ts`) by
 * `Editor.tsx` and `Canvas.tsx`, both client components — `Buffer` is a
 * Node.js global with no polyfill configured in `next.config.mjs`, so using
 * it here would throw `Buffer is not defined` the moment this decode path
 * runs in a real browser. `atob`/`btoa` are available in both Node and
 * browsers (see the identical pattern already used in
 * `lib/session-auth/jwt.ts`'s `base64url`/`base64urlDecode`), so this mirrors
 * that approach instead of adding a `buffer` polyfill dependency.
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Backward-compat reader for the pre-#188 Yjs-wrapped storage format.
 *
 * Historically `encodeCrdtState()` (removed in #188) built a brand-new Y.Doc
 * from the complete JSON state on every save and stored it as
 * `{ yjs: true, data: <base64> }`. That was never a functioning CRDT — each
 * save created an unrelated document with a fresh client id, so merging two
 * such payloads concatenated/duplicated content instead of converging.
 *
 * CollabPro now stores documents/whiteboards as plain JSON. This module is
 * kept ONLY so that rows written before the migration can still be read; new
 * writes never produce the yjs-wrapped shape again. Once resaved, a row is
 * naturally migrated to plain JSON and this path is no longer exercised for
 * it (no bulk migration script needed).
 */
export function decodeLegacyCrdtState(storedStr: string | null | undefined, fallbackDefault: any): any {
  if (!storedStr) return fallbackDefault;

  try {
    const parsed = JSON.parse(storedStr);

    // Check if it is a legacy Yjs update
    if (parsed && parsed.yjs && parsed.data) {
      const update = base64ToUint8Array(parsed.data);
      const doc = new Y.Doc();
      Y.applyUpdate(doc, update);

      const map = doc.getMap('state');

      const getDeep = (ymap: Y.Map<any>): any => {
        const obj: any = {};
        for (const key of Array.from(ymap.keys())) {
          const val = ymap.get(key);
          if (val instanceof Y.Array) {
            obj[key] = val.toArray().map((item: any) => {
              if (item instanceof Y.Map) {
                return getDeep(item);
              }
              return item;
            });
          } else if (val instanceof Y.Map) {
            obj[key] = getDeep(val);
          } else {
            obj[key] = val;
          }
        }
        return obj;
      };

      return getDeep(map);
    }

    // Not yjs-wrapped: standard plain-JSON payload, return as-is
    return parsed;
  } catch (e) {
    // If JSON parsing fails (e.g. raw string is not JSON), return the fallback
    return fallbackDefault;
  }
}

/**
 * True if the parsed value looks like the legacy `{ yjs: true, data: <base64> }`
 * envelope produced by the pre-#188 encoder.
 */
export function isLegacyYjsPayload(parsed: any): boolean {
  return !!(parsed && typeof parsed === 'object' && parsed.yjs === true && typeof parsed.data === 'string');
}
