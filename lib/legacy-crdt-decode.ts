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
 * Strict version of `decodeLegacyCrdtState`: does the actual base64 → Y.Doc →
 * applyUpdate → recursive decode work and lets any error (bad JSON, not
 * actually yjs-wrapped, corrupted Y.Doc, whatever) propagate to the caller
 * instead of swallowing it.
 *
 * `decodeLegacyCrdtState` wraps this in a try/catch that returns a fallback
 * default on any failure — the right call for its live-request callers
 * (`decodeState`, `state-sync-helpers.ts`), where a corrupted row should
 * degrade to an empty default rather than 500 the request. But that same
 * leniency is wrong for a one-time bulk migration
 * (`scripts/migrate-legacy-crdt.ts`): silently returning `{}`/`[]` for a
 * corrupted row is indistinguishable from "this row's real content happens
 * to be empty," and a migration script that can't tell the difference will
 * write the empty fallback back over the user's actual data. Callers that
 * need to know decoding actually failed use this strict version directly.
 */
export function decodeLegacyCrdtStateStrict(storedStr: string): any {
  const parsed = JSON.parse(storedStr);

  if (!parsed || !parsed.yjs || !parsed.data) {
    // Not yjs-wrapped: standard plain-JSON payload, return as-is
    return parsed;
  }

  const update = base64ToUint8Array(parsed.data);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);

  const map = doc.getMap('state');

  // Recursively decode every nested Y value, not just direct Y.Map
  // children of a Y.Array — a nested Y.Array item is now itself
  // decoded (previously left as an unconverted Y.Array instance).
  //
  // A nested array-of-arrays item (e.g. a whiteboard element's
  // `points: [[x, y], [x, y]]`) round-trips through the old encoder as
  // a Y.Map with numeric-string keys ("0", "1", ...), NOT a Y.Array —
  // its array-item conversion wrapped any object-typed item, including
  // a nested array, in a Y.Map as a byproduct of recursing over
  // Object.entries. That shape is indistinguishable here from a
  // genuine object whose keys happen to be numeric strings, so this
  // generic decoder deliberately does NOT guess and convert it back to
  // an array — doing so risked silently corrupting real numeric-keyed
  // objects elsewhere. Callers that know a specific field is always an
  // array by schema (e.g. Excalidraw's `points`) should recover that
  // shape themselves; see `coerceNumericKeyedArray` in
  // `lib/state-sync-helpers.ts`.
  const decodeValue = (val: any): any => {
    if (val instanceof Y.Array) {
      return val.toArray().map(decodeValue);
    }
    if (val instanceof Y.Map) {
      const obj: any = {};
      for (const key of Array.from(val.keys())) {
        obj[key] = decodeValue(val.get(key));
      }
      return obj;
    }
    return val;
  };

  const getDeep = (ymap: Y.Map<any>): any => {
    const obj: any = {};
    for (const key of Array.from(ymap.keys())) {
      obj[key] = decodeValue(ymap.get(key));
    }
    return obj;
  };

  return getDeep(map);
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
 * it. See `decodeLegacyCrdtStateStrict` for the error-propagating variant
 * used by the bulk migration script (`scripts/migrate-legacy-crdt.ts`).
 */
export function decodeLegacyCrdtState(storedStr: string | null | undefined, fallbackDefault: any): any {
  if (!storedStr) return fallbackDefault;

  try {
    return decodeLegacyCrdtStateStrict(storedStr);
  } catch (e) {
    // If decoding fails for any reason (bad JSON, corrupted Y.Doc update,
    // etc.), return the fallback so a corrupted row degrades gracefully
    // instead of throwing through to a live request.
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
