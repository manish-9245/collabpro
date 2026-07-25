// Canonical implementations moved to lib/state-sync-helpers.ts (issue #189) so
// the standalone ws-server process (which runs outside the Next.js bundler
// via tsx and imports lib/ with relative paths) can share the exact same
// code instead of hand-copying a diverged duplicate. This file re-exports
// them so existing "@/app/api/state-sync/services/helpers" imports keep
// working unchanged.
export {
  type ConflictStrategy,
  mapConvexIds,
  asJsonString,
  parseJsonIfString,
  asEditorDocument,
  asWhiteboardElements,
  mergeDocumentBlocks,
  mergeWhiteboardById,
  mergeWhiteboardPayloads,
} from '@/lib/state-sync-helpers';
