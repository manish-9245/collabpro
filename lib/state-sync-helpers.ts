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

export function asEditorDocument(value: unknown): Record<string, any> {
  const parsed = parseJsonIfString(value);
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).blocks)) {
    return parsed as Record<string, any>;
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
  throw new Error("Invalid whiteboard payload. Expected Excalidraw elements array or { elements }.");
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
 * Merges a stored whiteboard payload with an incoming one, by element id
 * (issue #188). New writes are always plain JSON element arrays; `currentStr`
 * may still be a legacy pre-#188 `{ yjs: true, data: <base64> }` row that
 * hasn't been resaved yet, in which case it's decoded via
 * `decodeLegacyCrdtState` before merging. Once resaved it becomes plain JSON
 * and this fallback is no longer exercised for that row.
 */
export function mergeWhiteboardPayloads(currentStr: string, incomingStr: string): string {
  let currentElements: any[];
  try {
    currentElements = asWhiteboardElements(currentStr || '[]');
  } catch {
    try {
      const parsedCurrent = parseJsonIfString(currentStr);
      currentElements = isLegacyYjsPayload(parsedCurrent)
        ? coerceToElementsArray(decodeLegacyCrdtState(currentStr, []))
        : [];
    } catch {
      currentElements = [];
    }
  }

  let incomingElements: any[];
  try {
    incomingElements = asWhiteboardElements(incomingStr);
  } catch {
    return incomingStr;
  }

  const mergedElements = mergeWhiteboardById(currentElements, incomingElements);
  return JSON.stringify(mergedElements);
}
