import { decodeLegacyCrdtState, isLegacyYjsPayload } from './legacy-crdt-decode';

/**
 * Encodes editor/whiteboard state for storage as plain JSON (issue #188).
 *
 * Previously this wrapped the state in a brand-new Yjs document on every
 * save, which was not a functioning CRDT (fresh client id each time meant
 * `Y.mergeUpdates` on two such payloads concatenated/duplicated content
 * instead of converging). Storage is now explicit, testable plain JSON, with
 * id-keyed merge (see `mergeDocumentBlocks` / `mergeWhiteboardById`) doing
 * the real conflict resolution.
 */
export function encodeState(state: any): string {
  if (state === undefined || state === null) return "";
  return JSON.stringify(state);
}

/**
 * Decodes stored document/whiteboard state.
 *
 * New rows are always plain JSON and are returned directly. Rows written
 * before the #188 migration may still be wrapped in the legacy
 * `{ yjs: true, data: <base64> }` envelope; those transparently fall back to
 * `decodeLegacyCrdtState`. A row written in the legacy format is naturally
 * migrated to plain JSON the next time it's saved.
 */
export function decodeState(storedStr: string | null | undefined, fallbackDefault: any): any {
  if (!storedStr) return fallbackDefault;

  try {
    const parsed = JSON.parse(storedStr);
    if (isLegacyYjsPayload(parsed)) {
      return decodeLegacyCrdtState(storedStr, fallbackDefault);
    }
    return parsed;
  } catch {
    return fallbackDefault;
  }
}
