import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as stateSyncPOST } from '@/app/api/state-sync/route';
import { prisma } from '@/lib/db';
import { decodeCrdtState, encodeCrdtState } from '@/lib/crdt';

// Mock database prisma
const mockFileFindUnique = vi.fn();
const mockFileUpdate = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    file: {
      findUnique: (...args: any[]) => mockFileFindUnique(...args),
      update: (...args: any[]) => mockFileUpdate(...args),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
  });

  describe('Issue #142: Last-Writer-Wins Data Loss Prevention (State Merging)', () => {
    it('should concurrently merge document block updates rather than blindly overwriting', async () => {
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

      // Verify prisma update was called with merged blocks
      expect(mockFileUpdate).toHaveBeenCalled();
      const lastUpdateCallArgs = mockFileUpdate.mock.calls[0][0];
      const savedDoc = JSON.parse(lastUpdateCallArgs.data.document);
      expect(savedDoc.blocks).toHaveLength(2);
      expect(savedDoc.blocks.map((b: any) => b.id)).toContain('block-1');
      expect(savedDoc.blocks.map((b: any) => b.id)).toContain('block-2');
    });

    it('should merge whiteboard element updates by ID concurrently instead of blindly overwriting', async () => {
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

      expect(mockFileUpdate).toHaveBeenCalled();
      const lastUpdateCallArgs = mockFileUpdate.mock.calls[0][0];
      const savedElements = JSON.parse(lastUpdateCallArgs.data.whiteboard);
      expect(savedElements).toHaveLength(2);
      expect(savedElements.map((el: any) => el.id)).toContain('el-1');
      expect(savedElements.map((el: any) => el.id)).toContain('el-2');
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

      expect(mockFileUpdate).toHaveBeenCalled();
      const lastUpdateCallArgs = mockFileUpdate.mock.calls[0][0];
      const savedElements = JSON.parse(lastUpdateCallArgs.data.whiteboard);
      
      // el-2 should be gone, el-1 should be updated (x: 15, y: 15), el-3 should be added
      expect(savedElements).toHaveLength(2);
      expect(savedElements.map((el: any) => el.id)).not.toContain('el-2');
      expect(savedElements.find((el: any) => el.id === 'el-1')?.x).toBe(15);
      expect(savedElements.map((el: any) => el.id)).toContain('el-3');
    });
  });

  describe('Issue #143: Server-side Mutation Debouncing & Coalescing', () => {
    it('should debounce rapid consecutive state updates for the same file on the server and only call DB update once', async () => {
      const incomingDoc = {
        time: 2000,
        blocks: [],
        version: '2.8.1'
      };

      mockFileFindUnique.mockResolvedValue({
        id: 'file-debounce-123',
        document: '{"blocks":[]}',
        whiteboard: '[]',
        createdBy: 'user@test.com'
      });

      // Send 5 rapid updates
      const promises = Array.from({ length: 5 }).map((_, i) => {
        const req = new Request('http://localhost/api/state-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: 'files:updateDocument',
            args: {
              _id: 'file-debounce-123',
              document: JSON.stringify({
                ...incomingDoc,
                blocks: [{ id: `block-debounce-${i}`, type: 'paragraph', data: { text: `text-${i}` } }]
              }),
            },
          }),
        });
        return stateSyncPOST(req);
      });

      await Promise.all(promises);

      // Verify prisma update was called exactly ONCE due to coalescing
      expect(mockFileUpdate).toHaveBeenCalledTimes(1);
      
      const lastUpdateCallArgs = mockFileUpdate.mock.calls[0][0];
      const savedDoc = JSON.parse(lastUpdateCallArgs.data.document);
      
      // All blocks should be merged into the single final write!
      expect(savedDoc.blocks).toHaveLength(5);
    });
  });
});
