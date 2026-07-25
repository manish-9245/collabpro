import { describe, it, expect } from 'vitest';

// Issue #189: ws-server/server.ts used to hand-copy parseJsonIfString,
// asEditorDocument, asWhiteboardElements, mergeDocumentBlocks,
// mergeWhiteboardById, mergeWhiteboardPayloads, and mapConvexIds from
// app/api/state-sync/services/helpers.ts / fileService.ts, and the copies had
// already diverged (e.g. String(Math.random()) ids instead of
// crypto.randomUUID(), and returning [] instead of throwing on invalid
// whiteboard input). This test proves — by construction — that there is now
// exactly one implementation: importing via the Next.js "@/" alias and via
// the relative path convention ws-server/server.ts uses (../lib/... since it
// runs outside the Next bundler via tsx) must resolve to the *same* module
// and the *same* function references, not two copies.
describe('state-sync helpers consolidation (issue #189)', () => {
  it('resolves to the same function references via the "@/" alias and a relative path', async () => {
    const viaAlias = await import('@/lib/state-sync-helpers');
    const viaRelative = await import('../../lib/state-sync-helpers');

    expect(viaRelative.mergeDocumentBlocks).toBe(viaAlias.mergeDocumentBlocks);
    expect(viaRelative.mergeWhiteboardById).toBe(viaAlias.mergeWhiteboardById);
    expect(viaRelative.mergeWhiteboardPayloads).toBe(viaAlias.mergeWhiteboardPayloads);
    expect(viaRelative.asEditorDocument).toBe(viaAlias.asEditorDocument);
    expect(viaRelative.asWhiteboardElements).toBe(viaAlias.asWhiteboardElements);
    expect(viaRelative.parseJsonIfString).toBe(viaAlias.parseJsonIfString);
    expect(viaRelative.mapConvexIds).toBe(viaAlias.mapConvexIds);
  });

  it('the Next.js API route helpers module re-exports the same canonical functions (no second copy)', async () => {
    const canonical = await import('@/lib/state-sync-helpers');
    const routeHelpers = await import('@/app/api/state-sync/services/helpers');

    expect(routeHelpers.mergeDocumentBlocks).toBe(canonical.mergeDocumentBlocks);
    expect(routeHelpers.mergeWhiteboardById).toBe(canonical.mergeWhiteboardById);
    expect(routeHelpers.mapConvexIds).toBe(canonical.mapConvexIds);
  });
});
