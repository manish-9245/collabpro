import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as stateSyncPOST } from '@/app/api/state-sync/route';
import { prisma } from '@/lib/db';

// Mock database prisma
const mockFileFindUnique = vi.fn();
const mockFileUpdateMany = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    file: {
      findUnique: (...args: any[]) => mockFileFindUnique(...args),
      update: vi.fn(),
      updateMany: (...args: any[]) => mockFileUpdateMany(...args),
    },
    user: {
      findUnique: vi.fn(),
    },
    apiKey: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock getServerSession
const mockGetUser = vi.fn();
vi.mock('@/lib/session-auth/server', () => ({
  getServerSession: () => ({
    getUser: mockGetUser,
  }),
}));

describe('GrahakAI Performance & Sync Engine Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'user@test.com', name: 'Test User' });
    // files:updateDocument / files:updateWhiteboard now write via a
    // compare-and-swap prisma.file.updateMany (issue #197 partial), not
    // prisma.file.update. Single-request tests below don't race against
    // anything, so a CAS attempt always succeeds on the first try.
    mockFileUpdateMany.mockResolvedValue({ count: 1 });
  });

  describe('Issue #142 / review round 2 Group 2: full-snapshot saves use replace semantics, deletions respected', () => {
    // Originally these tests asserted files:updateDocument/files:updateWhiteboard
    // UNION-merged the incoming payload with whatever was already stored.
    // That was itself a bug (flagged in review): a full-snapshot save from
    // the live editor represents the user's *complete current state* —
    // union-merging it with "current" means a block/element the user just
    // deleted can never actually be removed, because it's still present on
    // the "current" side of the merge and comes right back. Full-snapshot
    // saves must be authoritative (replace), so deletions persist; only the
    // explicit `{isDelta:true}` envelope legitimately represents a partial
    // update and still does the merge dance (see the delta test below).
    it('files:updateDocument replaces the stored document with the incoming snapshot, dropping content the client no longer has', async () => {
      const existingDoc = {
        time: 1000,
        blocks: [
          { id: 'block-1', type: 'paragraph', data: { text: 'Hello' } }
        ],
        version: '2.8.1'
      };

      const incomingDoc = {
        time: 2000,
        blocks: [
          { id: 'block-2', type: 'paragraph', data: { text: 'World' } }
        ],
        version: '2.8.1'
      };

      mockFileFindUnique.mockResolvedValue({
        id: 'file-123',
        document: JSON.stringify(existingDoc),
        whiteboard: '[]',
        createdBy: 'user@test.com'
      });

      const req = new Request('http://localhost/api/state-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'files:updateDocument',
          args: {
            _id: 'file-123',
            document: JSON.stringify(incomingDoc),
          },
        }),
      });

      const res = await stateSyncPOST(req);
      expect(res.status).toBe(200);

      expect(mockFileUpdateMany).toHaveBeenCalled();
      const lastUpdateCallArgs = mockFileUpdateMany.mock.calls[0][0];
      const savedDoc = JSON.parse(lastUpdateCallArgs.data.document);
      expect(savedDoc.blocks).toHaveLength(1);
      expect(savedDoc.blocks.map((b: any) => b.id)).toEqual(['block-2']);
    });

    it('a document save that omits a previously-existing block actually removes it (deletion persists)', async () => {
      mockFileFindUnique.mockResolvedValue({
        id: 'file-del-1',
        document: JSON.stringify({
          time: 1000,
          version: '2.8.1',
          blocks: [
            { id: 'block-1', type: 'paragraph', data: { text: 'Keep' } },
            { id: 'block-2', type: 'paragraph', data: { text: 'Delete me' } },
          ],
        }),
        whiteboard: '[]',
        createdBy: 'user@test.com',
      });

      const req = new Request('http://localhost/api/state-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'files:updateDocument',
          args: {
            _id: 'file-del-1',
            document: JSON.stringify({
              time: 2000,
              version: '2.8.1',
              blocks: [{ id: 'block-1', type: 'paragraph', data: { text: 'Keep' } }],
            }),
          },
        }),
      });

      const res = await stateSyncPOST(req);
      expect(res.status).toBe(200);

      const savedDoc = JSON.parse(mockFileUpdateMany.mock.calls[0][0].data.document);
      expect(savedDoc.blocks).toHaveLength(1);
      expect(savedDoc.blocks.map((b: any) => b.id)).toEqual(['block-1']);
    });

    it('files:updateWhiteboard replaces the stored elements with the incoming snapshot', async () => {
      const existingWhiteboard = JSON.stringify([
        { id: 'el-1', type: 'rectangle', x: 10, y: 10, version: 1 }
      ]);

      const incomingWhiteboard = JSON.stringify([
        { id: 'el-2', type: 'circle', x: 20, y: 20, version: 1 }
      ]);

      mockFileFindUnique.mockResolvedValue({
        id: 'file-123',
        document: '[]',
        whiteboard: existingWhiteboard,
        createdBy: 'user@test.com'
      });

      const req = new Request('http://localhost/api/state-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'files:updateWhiteboard',
          args: {
            _id: 'file-123',
            whiteboard: incomingWhiteboard,
          },
        }),
      });

      const res = await stateSyncPOST(req);
      expect(res.status).toBe(200);

      expect(mockFileUpdateMany).toHaveBeenCalled();
      const lastUpdateCallArgs = mockFileUpdateMany.mock.calls[0][0];
      const savedPayload = JSON.parse(lastUpdateCallArgs.data.whiteboard);
      expect(savedPayload.elements).toHaveLength(1);
      expect(savedPayload.elements.map((el: any) => el.id)).toEqual(['el-2']);
    });

    it('preserves the Excalidraw files map through a whiteboard save (issue found in review, Group 2)', async () => {
      mockFileFindUnique.mockResolvedValue({
        id: 'file-files-1',
        document: '[]',
        whiteboard: '[]',
        createdBy: 'user@test.com',
      });

      const req = new Request('http://localhost/api/state-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'files:updateWhiteboard',
          args: {
            _id: 'file-files-1',
            whiteboard: JSON.stringify({
              elements: [{ id: 'el-1', type: 'image', x: 0, fileId: 'file-a' }],
              files: { 'file-a': { id: 'file-a', dataURL: 'data:image/png;base64,aaa' } },
            }),
          },
        }),
      });

      const res = await stateSyncPOST(req);
      expect(res.status).toBe(200);

      const savedPayload = JSON.parse(mockFileUpdateMany.mock.calls[0][0].data.whiteboard);
      expect(savedPayload.files).toEqual({ 'file-a': { id: 'file-a', dataURL: 'data:image/png;base64,aaa' } });
    });
  });

  describe('Issue #144: Delta State & Diff Network Transmission', () => {
    it('should correctly process a delta-state whiteboard payload and apply diff updates to database', async () => {
      const existingWhiteboard = JSON.stringify([
        { id: 'el-1', type: 'rectangle', x: 10, y: 10, version: 1 },
        { id: 'el-2', type: 'circle', x: 20, y: 20, version: 1 }
      ]);

      // Delta: element el-1 is updated, el-2 is deleted, el-3 is inserted
      const deltaPayload = {
        isDelta: true,
        updated: [
          { id: 'el-1', type: 'rectangle', x: 15, y: 15, version: 2 },
          { id: 'el-3', type: 'diamond', x: 30, y: 30, version: 1 }
        ],
        deleted: ['el-2']
      };

      mockFileFindUnique.mockResolvedValue({
        id: 'file-123',
        document: '[]',
        whiteboard: existingWhiteboard,
        createdBy: 'user@test.com'
      });

      const req = new Request('http://localhost/api/state-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'files:updateWhiteboard',
          args: {
            _id: 'file-123',
            whiteboard: JSON.stringify(deltaPayload),
          },
        }),
      });

      const res = await stateSyncPOST(req);
      expect(res.status).toBe(200);

      expect(mockFileUpdateMany).toHaveBeenCalled();
      const lastUpdateCallArgs = mockFileUpdateMany.mock.calls[0][0];
      const savedPayload = JSON.parse(lastUpdateCallArgs.data.whiteboard);
      const savedElements = savedPayload.elements;

      // el-2 should be gone, el-1 should be updated (x: 15, y: 15), el-3 should be added
      expect(savedElements).toHaveLength(2);
      expect(savedElements.map((el: any) => el.id)).not.toContain('el-2');
      expect(savedElements.find((el: any) => el.id === 'el-1')?.x).toBe(15);
      expect(savedElements.map((el: any) => el.id)).toContain('el-3');
    });
  });

  describe('Issue #197 (partial): compare-and-swap replaces the debounce map', () => {
    // The old module-level debounce map coalesced concurrent writes in a
    // single process, but had a race: two concurrent requests could both
    // read the current row before either seeded the debounce map, so both
    // merged from the same stale base and the later flush silently dropped
    // the earlier request's changes. It's been replaced with the same
    // compare-and-swap (read, `updateMany` gated on an unchanged document,
    // retry on conflict) pattern already used by `collabpro_update_document`
    // — full-snapshot replace semantics (see Group 2 tests above), not
    // merge. A single, uncontested request now does exactly one findUnique +
    // one updateMany, no debounce delay.
    //
    // See tests/unit/cas-concurrent-writes.test.ts for coverage of the
    // actual concurrent-writer race (simulated via a stateful updateMany
    // mock) proving the race resolves via retry rather than a silently
    // dropped or corrupted write.
    it('performs a single read-then-CAS-write with no debounce delay for an uncontested request', async () => {
      mockFileFindUnique.mockResolvedValue({
        id: 'file-cas-single-123',
        document: JSON.stringify({ time: 1000, blocks: [{ id: 'existing', type: 'paragraph', data: { text: 'base' } }], version: '2.8.1' }),
        whiteboard: '[]',
        createdBy: 'user@test.com'
      });

      const req = new Request('http://localhost/api/state-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'files:updateDocument',
          args: {
            _id: 'file-cas-single-123',
            document: JSON.stringify({ time: 2000, blocks: [{ id: 'new-block', type: 'paragraph', data: { text: 'added' } }], version: '2.8.1' }),
          },
        }),
      });

      const res = await stateSyncPOST(req);
      expect(res.status).toBe(200);

      expect(mockFileUpdateMany).toHaveBeenCalledTimes(1);
      const savedDoc = JSON.parse(mockFileUpdateMany.mock.calls[0][0].data.document);
      // Replace semantics: the incoming snapshot is authoritative — it does
      // NOT get unioned with "existing".
      expect(savedDoc.blocks.map((b: any) => b.id)).toEqual(['new-block']);
    });
  });
});
