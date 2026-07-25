import {
  asEditorDocument,
  asWhiteboardPayload,
  asJsonString,
  parseJsonIfString,
  mergeWhiteboardById,
  type WhiteboardPayload,
} from './state-sync-helpers';
import { extractTextFromWhiteboard } from './file-service';

/**
 * Canonical compare-and-swap document/whiteboard writers (issue #197 partial,
 * review round 2). This is the single source of truth for CAS writes — both
 * the HTTP path (`app/api/state-sync/services/fileService.ts`) and the
 * standalone WS gateway (`ws-server/mutations.ts`) call these directly
 * instead of each reimplementing their own version. Lives under `lib/` (not
 * `app/api/...`) so `ws-server` can import it via a relative path, matching
 * its existing `../lib/db` convention.
 *
 * Two review-round-2 correctness fixes live here:
 *
 * 1. The CAS `where` predicate compares against the EXACT raw value just
 *    read from the row — never a normalized/re-serialized version of it. A
 *    brand-new file's default document/whiteboard is the raw empty string
 *    `""` (see `files:createFile`), not a synthesized empty Editor.js
 *    document object or `"[]"`. Comparing against the synthesized form means
 *    the predicate can never match, so every save on a fresh file conflicted
 *    forever. Normalization is used only to compute the next value, never to
 *    build the CAS predicate.
 *
 * 2. Full-snapshot saves use REPLACE semantics: the incoming payload is the
 *    complete, current state of the user's editor and is authoritative,
 *    including for content the user deleted. The previous id-union merge
 *    could not represent a deletion — a removed block/element always
 *    reappeared because it was still present on the "current" side of the
 *    union. Only the explicit whiteboard delta envelope
 *    (`{isDelta:true, updated, deleted}`) legitimately represents a partial
 *    update, so only that path still does the union/merge dance (and it
 *    decodes a legacy pre-#188 Yjs-wrapped current row first, via
 *    `asWhiteboardPayload`, rather than failing or discarding it).
 */

export interface CasPrismaClient {
  file: {
    findUnique: (args: { where: { id: string }; select: Record<string, true> }) => Promise<Record<string, any> | null>;
    updateMany: (args: { where: Record<string, any>; data: Record<string, any> }) => Promise<{ count: number }>;
  };
}

export interface CasWriteOptions {
  /** Called once the write has actually persisted (e.g. cache invalidation). Failures here do not affect the returned result. */
  onPersisted?: (fileId: string) => Promise<void> | void;
  maxAttempts?: number;
}

const DEFAULT_MAX_ATTEMPTS = 5;

async function runOnPersisted(fileId: string, options: CasWriteOptions): Promise<void> {
  if (!options.onPersisted) return;
  try {
    await options.onPersisted(fileId);
  } catch (err) {
    console.error(`[CAS WRITE] onPersisted callback failed for file ${fileId}:`, err);
  }
}

/**
 * Compare-and-swap document write. Full-snapshot replace semantics — the
 * incoming document becomes the file's document exactly as given (after
 * normalization), regardless of what "current" contains, because Editor.js
 * autosave always sends the editor's complete current state.
 */
export async function casUpdateDocument(
  prismaClient: CasPrismaClient,
  targetFileId: string,
  incomingDocument: unknown,
  options: CasWriteOptions = {}
): Promise<Record<string, any>> {
  const normalizedIncoming = asEditorDocument(incomingDocument);
  const nextDocString = asJsonString(normalizedIncoming);
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const file = await prismaClient.file.findUnique({
      where: { id: targetFileId },
      select: { document: true },
    });
    // Raw value exactly as stored — never normalized/synthesized. A
    // brand-new file's `document` column is the empty string, and the CAS
    // predicate must match THAT, not a stand-in default object.
    const rawCurrentDocString = file?.document ?? '';

    const updated = await prismaClient.file.updateMany({
      where: { id: targetFileId, document: rawCurrentDocString },
      data: { document: nextDocString },
    });

    if (updated.count === 1) {
      await runOnPersisted(targetFileId, options);
      return normalizedIncoming;
    }
    // Someone else wrote first — loop and retry against the fresh row.
  }

  throw new Error("Unable to update document due to concurrent updates. Please retry.");
}

function applyWhiteboardDelta(current: WhiteboardPayload, delta: any): WhiteboardPayload {
  const updated = Array.isArray(delta.updated) ? delta.updated : [];
  const deleted = Array.isArray(delta.deleted) ? delta.deleted : [];

  const elementMap = new Map<string, any>();
  current.elements.forEach((el: any) => { if (el && el.id) elementMap.set(el.id, el); });
  deleted.forEach((id: string) => { elementMap.delete(id); });
  updated.forEach((el: any) => { if (el && el.id) elementMap.set(el.id, el); });

  const deltaFiles = delta.files && typeof delta.files === 'object' ? delta.files : {};
  return {
    elements: Array.from(elementMap.values()),
    files: { ...current.files, ...deltaFiles },
  };
}

/**
 * Compare-and-swap whiteboard write. Returns the final whiteboard JSON
 * string (`{ elements, files }`), matching the historical external contract
 * of `files:updateWhiteboard`.
 *
 * - Explicit delta envelope (`{isDelta:true, updated, deleted}`): applies the
 *   update/delete on top of the current stored content (legacy-decoded
 *   first if needed) — this is the one legitimately partial update path.
 * - Anything else: full-snapshot replace — incoming elements + files become
 *   the whiteboard's content exactly as given, deletions respected.
 */
export async function casUpdateWhiteboard(
  prismaClient: CasPrismaClient,
  targetFileId: string,
  incomingWhiteboard: unknown,
  options: CasWriteOptions = {}
): Promise<string> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const file = await prismaClient.file.findUnique({
      where: { id: targetFileId },
      select: { whiteboard: true },
    });
    const rawCurrentWhiteboardString = file?.whiteboard ?? '';

    // Issue found in review (Group 5): a malformed incoming payload must be
    // REJECTED (thrown, so the caller's mutation fails and the client sees
    // an error) — not silently persisted as-is, and definitely not silently
    // replaced with an empty whiteboard. Only the CURRENT-side parse (below,
    // for the delta branch) tolerates a fallback, since an unreadable
    // *existing* row is a different, lower-risk situation than trusting
    // unparseable new input.
    let nextPayload: WhiteboardPayload;
    const parsedIncoming = parseJsonIfString(incomingWhiteboard);
    if (parsedIncoming && typeof parsedIncoming === 'object' && (parsedIncoming as any).isDelta) {
      const currentPayload = (() => {
        try {
          return asWhiteboardPayload(rawCurrentWhiteboardString || '[]');
        } catch {
          return { elements: [], files: {} } as WhiteboardPayload;
        }
      })();
      nextPayload = applyWhiteboardDelta(currentPayload, parsedIncoming);
    } else {
      nextPayload = asWhiteboardPayload(incomingWhiteboard);
    }

    const nextWhiteboardString = JSON.stringify(nextPayload);
    const nextText = extractTextFromWhiteboard(nextWhiteboardString);

    const updated = await prismaClient.file.updateMany({
      where: { id: targetFileId, whiteboard: rawCurrentWhiteboardString },
      data: { whiteboard: nextWhiteboardString, whiteboardText: nextText },
    });

    if (updated.count === 1) {
      await runOnPersisted(targetFileId, options);
      return nextWhiteboardString;
    }
    // Someone else wrote first — loop and retry against the fresh row.
  }

  throw new Error("Unable to update whiteboard due to concurrent updates. Please retry.");
}
