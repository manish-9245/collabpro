import { prisma } from '../lib/db';
import { decodeLegacyCrdtStateStrict, isLegacyYjsPayload } from '../lib/legacy-crdt-decode';
import { encodeState } from '../lib/state-encode';

/**
 * One-time backfill for issue #242: rewrites every `File` row still holding
 * the pre-#188 legacy `{ yjs: true, data: <base64> }` envelope (see
 * lib/legacy-crdt-decode.ts) as plain JSON, so reads no longer have to pay
 * the legacy decode path and a file nobody resaves doesn't depend on it
 * forever. Not a migration off `decodeState`'s compat shim itself — that
 * stays in place; this just shrinks how many rows still need it.
 */
export interface MigrationSummary {
  scanned: number;
  documentsMigrated: number;
  whiteboardsMigrated: number;
  failed: number;
}

function isLegacyField(stored: string | null | undefined): boolean {
  if (!stored) return false;
  try {
    return isLegacyYjsPayload(JSON.parse(stored));
  } catch {
    return false;
  }
}

export async function migrateLegacyCrdtRows(prismaClient: {
  file: { findMany: (...args: any[]) => Promise<any>; update: (...args: any[]) => Promise<any> };
}): Promise<MigrationSummary> {
  const rows = await prismaClient.file.findMany({
    select: { id: true, document: true, whiteboard: true },
  });

  const summary: MigrationSummary = { scanned: rows.length, documentsMigrated: 0, whiteboardsMigrated: 0, failed: 0 };

  for (const row of rows) {
    const data: { document?: string; whiteboard?: string } = {};

    // Use the strict decoder (throws on failure) rather than the lenient
    // decodeLegacyCrdtState used on the live read path: a corrupted legacy
    // blob must NOT be written back as the empty fallback default — that
    // would silently destroy the row's real content and still get counted
    // as a successful migration. A field that fails to decode is simply
    // left out of `data` (never written) and counted as `failed`; the row
    // keeps its existing legacy value, still readable via decodeState.
    if (isLegacyField(row.document)) {
      try {
        data.document = encodeState(decodeLegacyCrdtStateStrict(row.document as string));
      } catch (err) {
        summary.failed++;
        console.error(`[migrate-legacy-crdt] failed to decode document for row ${row.id}:`, err);
      }
    }
    if (isLegacyField(row.whiteboard)) {
      try {
        data.whiteboard = encodeState(decodeLegacyCrdtStateStrict(row.whiteboard as string));
      } catch (err) {
        summary.failed++;
        console.error(`[migrate-legacy-crdt] failed to decode whiteboard for row ${row.id}:`, err);
      }
    }

    if (Object.keys(data).length === 0) continue;

    try {
      await prismaClient.file.update({ where: { id: row.id }, data });
      if (data.document !== undefined) summary.documentsMigrated++;
      if (data.whiteboard !== undefined) summary.whiteboardsMigrated++;
    } catch (err) {
      summary.failed++;
      console.error(`[migrate-legacy-crdt] failed to update row ${row.id}:`, err);
    }
  }

  return summary;
}

export async function main() {
  const summary = await migrateLegacyCrdtRows(prisma);
  console.log('[migrate-legacy-crdt] done:', summary);
  // Make a failed run detectable from the process exit code, not just by
  // someone reading the logged summary. process.exitCode (not process.exit())
  // so the .finally(() => prisma.$disconnect()) below still runs.
  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

// Only run when executed directly (`tsx scripts/migrate-legacy-crdt.ts`), not
// when `migrateLegacyCrdtRows` is imported by the test suite.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error).finally(() => prisma.$disconnect());
}
