import { decodeLegacyCrdtState, isLegacyYjsPayload } from './legacy-crdt-decode';

/**
 * Canonical state-sync merge/normalization helpers (issue #189).
 *
 * This is the single source of truth for these functions. Previously
 * ws-server/server.ts hand-copied and diverged from the versions in
 * app/api/state-sync/services/helpers.ts / fileService.ts (e.g. it used
 * `String(Math.random())` for ids instead of `crypto.randomUUID()`, and
 * returned `[]` on invalid whiteboard input instead of throwing).
 *
 * This file lives under `lib/` (not `app/api/...`) specifically so the
 * standalone `ws-server` process — which runs outside the Next.js bundler via
 * `tsx` and imports from `lib/` using relative paths (e.g. `../lib/db`) — can
 * import it the same way, with no duplication.
 */

export type ConflictStrategy = 'reject' | 'merge' | 'overwrite';

export function mapConvexIds(obj: any): any {
  if (!obj) return obj;
  if (Array.isArray(obj)) {
    return obj.map(mapConvexIds);
  }
  if (typeof obj === 'object') {
    if (obj instanceof Date) return obj.toISOString();

    const newObj: any = {};
    // Object.getOwnPropertyNames already covers every own key a Prisma
    // result object has; a second `for...in` loop only adds anything for
    // *inherited* enumerable properties, which these plain objects don't
    // have, so it was redundant and has been removed.
    for (const key of Object.getOwnPropertyNames(obj)) {
      newObj[key] = mapConvexIds(obj[key]);
    }
    if (obj.id !== undefined && obj._id === undefined) {
      newObj._id = obj.id;
    }
    return newObj;
  }
  return obj;
}

export function asJsonString(value: unknown): string {
  return JSON.stringify(value);
}

export function parseJsonIfString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Best-effort recovery of an elements array from a legacy-decoded value.
 * The old encodeCrdtState() encoded plain objects via Object.entries(), so a
 * top-level array sometimes round-trips as a numeric-keyed object rather
 * than a real array; this makes a reasonable attempt to recover it instead
 * of discarding the row's content outright.
 */
function coerceToElementsArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    if (Array.isArray((value as any).elements)) return (value as any).elements;
    const values = Object.values(value);
    if (values.length > 0 && values.every((v) => v && typeof v === 'object')) {
      return values;
    }
  }
  return [];
}

/**
 * Attempts to decode `value` as a legacy pre-#188 Yjs-wrapped payload
 * (`{ yjs: true, data: <base64> }`). Returns `undefined` if `value` doesn't
 * look like that envelope at all, so callers can tell "not legacy format"
 * apart from "legacy format that decoded to nothing useful".
 *
 * Every merge/normalize entry point below attempts this FIRST, before
 * falling through to new-format parsing or giving up — a file that hasn't
 * been resaved since the #188 migration must still be readable (and mergeable
 * with new content) via its real stored content, not treated as unparseable
 * garbage. Getting this backwards previously meant (1) a CAS write on a
 * legacy row failed outright, so it could never actually reach the "resaves
 * as plain JSON" migration path, and (2) callers that caught that failure and
 * fell back to "just use the incoming payload alone" silently destroyed the
 * user's existing legacy content.
 */
function tryDecodeLegacy(value: unknown): any | undefined {
  const parsed = parseJsonIfString(value);
  if (!isLegacyYjsPayload(parsed)) return undefined;
  const storedStr = typeof value === 'string' ? value : JSON.stringify(parsed);
  return decodeLegacyCrdtState(storedStr, undefined);
}

export function asEditorDocument(value: unknown): Record<string, any> {
  const parsed = parseJsonIfString(value);
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).blocks)) {
    return parsed as Record<string, any>;
  }

  const legacyDecoded = tryDecodeLegacy(value);
  if (legacyDecoded !== undefined) {
    if (legacyDecoded && typeof legacyDecoded === 'object' && Array.isArray(legacyDecoded.blocks)) {
      return legacyDecoded;
    }
    // Recognized as a legacy envelope but it didn't decode to a usable
    // `blocks` array (e.g. the old encoder's Object.entries()-based array
    // handling produced something unexpected) — treat as an empty document
    // rather than throwing, since there's nothing coherent to preserve, but
    // never silently fall through to "pretend this was never legacy".
    return { time: Date.now(), version: "2.8.1", blocks: [] };
  }

  if (typeof parsed === 'string') {
    const text = parsed.trim();
    return {
      time: Date.now(),
      version: "2.8.1",
      blocks: text ? [
        {
          id: crypto.randomUUID(),
          type: 'paragraph',
          data: { text }
        }
      ] : []
    };
  }

  throw new Error("Invalid document payload. Expected Editor.js JSON or string content.");
}

export function asWhiteboardElements(value: unknown): any[] {
  const parsed = parseJsonIfString(value);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).elements)) {
    return (parsed as any).elements;
  }

  const legacyDecoded = tryDecodeLegacy(value);
  if (legacyDecoded !== undefined) {
    return coerceToElementsArray(legacyDecoded);
  }

  throw new Error("Invalid whiteboard payload. Expected Excalidraw elements array or { elements }.");
}

export interface WhiteboardPayload {
  elements: any[];
  files: Record<string, any>;
}

/**
 * Like `asWhiteboardElements`, but also extracts (and, for legacy rows,
 * recovers) the Excalidraw `files` map — image/attachment binary data that
 * Excalidraw stores separately from the element list. `asWhiteboardElements`
 * alone silently discards it, which meant any image/attachment on a
 * whiteboard vanished the next time the whiteboard was saved through a merge
 * path that only round-tripped `elements`.
 */
export function asWhiteboardPayload(value: unknown): WhiteboardPayload {
  const parsed = parseJsonIfString(value);
  if (Array.isArray(parsed)) {
    return { elements: parsed, files: {} };
  }
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).elements)) {
    const files = (parsed as any).files;
    return {
      elements: (parsed as any).elements,
      files: files && typeof files === 'object' ? files : {},
    };
  }

  const legacyDecoded = tryDecodeLegacy(value);
  if (legacyDecoded !== undefined) {
    if (Array.isArray(legacyDecoded)) {
      return { elements: legacyDecoded, files: {} };
    }
    if (legacyDecoded && typeof legacyDecoded === 'object') {
      const files = (legacyDecoded as any).files;
      return {
        elements: coerceToElementsArray(legacyDecoded),
        files: files && typeof files === 'object' ? files : {},
      };
    }
    return { elements: [], files: {} };
  }

  throw new Error("Invalid whiteboard payload. Expected Excalidraw elements array or { elements, files }.");
}

export function mergeDocumentBlocks(currentDoc: Record<string, any>, incomingDoc: Record<string, any>): Record<string, any> {
  const currentBlocks = Array.isArray(currentDoc.blocks) ? currentDoc.blocks : [];
  const incomingBlocks = Array.isArray(incomingDoc.blocks) ? incomingDoc.blocks : [];
  const merged = new Map<string, any>();
  const order: string[] = [];
  for (const block of [...currentBlocks, ...incomingBlocks]) {
    if (!block || typeof block !== 'object') continue;
    const key = typeof block.id === 'string' && block.id.length > 0 ? block.id : crypto.randomUUID();
    if (!merged.has(key)) order.push(key);
    merged.set(key, block);
  }
  return {
    ...currentDoc,
    ...incomingDoc,
    time: Date.now(),
    version: incomingDoc.version || currentDoc.version || "2.8.1",
    blocks: order.map((k) => merged.get(k)),
  };
}

export function mergeWhiteboardById(currentElements: any[], incomingElements: any[]): any[] {
  const merged = new Map<string, any>();
  const ordered: string[] = [];

  for (const element of currentElements) {
    if (!element || typeof element !== 'object') continue;
    const key = typeof element.id === 'string' && element.id.length > 0 ? element.id : crypto.randomUUID();
    if (!merged.has(key)) ordered.push(key);
    merged.set(key, element);
  }

  for (const element of incomingElements) {
    if (!element || typeof element !== 'object') continue;
    const key = typeof element.id === 'string' && element.id.length > 0 ? element.id : crypto.randomUUID();
    if (!merged.has(key)) ordered.push(key);
    merged.set(key, element);
  }

  return ordered.map((key) => merged.get(key)).filter(Boolean);
}

/**
 * Merges a stored whiteboard payload with an incoming one, by element id
 * AND preserves/merges the Excalidraw `files` map alongside the elements
 * (issue #188 / review round 2). `asWhiteboardPayload` already attempts the
 * legacy pre-#188 decode first, so a not-yet-migrated row merges with its
 * real content instead of being treated as unreadable.
 *
 * This union-merge semantics is intentionally kept available as a general
 * utility (e.g. for callers that genuinely want two element sets combined),
 * but the CAS write paths (`lib/cas-writes.ts`) do NOT use it for
 * full-snapshot saves — a full snapshot from the client is authoritative for
 * what should exist, including deletions, and union-merging it against
 * "current" would make a deleted element reappear because it's still present
 * on the current side of the union.
 */
export function mergeWhiteboardPayloads(currentStr: string, incomingStr: string): string {
  let currentPayload: WhiteboardPayload;
  try {
    currentPayload = asWhiteboardPayload(currentStr || '[]');
  } catch {
    currentPayload = { elements: [], files: {} };
  }

  // A malformed incoming payload is REJECTED (thrown), never silently passed
  // through as raw invalid input to be persisted downstream (issue found in
  // review, Group 5). An unreadable CURRENT row still tolerates a fallback
  // above — that's a different, lower-risk situation than trusting
  // unparseable new input.
  const incomingPayload = asWhiteboardPayload(incomingStr);

  const mergedElements = mergeWhiteboardById(currentPayload.elements, incomingPayload.elements);
  const mergedFiles = { ...currentPayload.files, ...incomingPayload.files };
  return JSON.stringify({ elements: mergedElements, files: mergedFiles });
}
