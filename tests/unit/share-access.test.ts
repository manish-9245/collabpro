import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as stateSyncPOST } from '@/app/api/state-sync/route';
import { POST as sharePOST, GET as shareGET } from '@/app/api/share/route';
import { POST as verifyPOST } from '@/app/api/share/verify/route';

// Mock database prisma
const mockSharedLinkFindUnique = vi.fn();
const mockSharedLinkFindMany = vi.fn();
const mockSharedLinkCreate = vi.fn();
const mockSharedLinkUpdate = vi.fn();
const mockSharedLinkDelete = vi.fn();

const mockFileFindUnique = vi.fn();
const mockFileUpdate = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    sharedLink: {
      findUnique: (...args: any[]) => mockSharedLinkFindUnique(...args),
      findMany: (...args: any[]) => mockSharedLinkFindMany(...args),
      create: (...args: any[]) => mockSharedLinkCreate(...args),
      update: (...args: any[]) => mockSharedLinkUpdate(...args),
      delete: (...args: any[]) => mockSharedLinkDelete(...args),
    },
    file: {
      findUnique: (...args: any[]) => mockFileFindUnique(...args),
      update: (...args: any[]) => mockFileUpdate(...args),
    },
    apiKey: {
      findUnique: vi.fn(),
    },
    user: {
      upsert: vi.fn(),
      update: vi.fn(),
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

describe('Link Sharing Access Controls & Guest Privileges (Issue 58)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue(null); // Unauthenticated users by default to test guest flows
  });

  describe('Invalid Shared Link Handling', () => {
    it('should return 403 when sharedLinkId is not found in database', async () => {
      mockSharedLinkFindUnique.mockResolvedValueOnce(null);

      const req = new Request('http://localhost/api/state-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-shared-link-id': 'non-existent-id',
        },
        body: JSON.stringify({
          path: 'files:getFileById',
          args: { fileId: 'file-123' },
        }),
      });

      const res = await stateSyncPOST(req);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain('Share link not found');
    });

    it('should return 410 or 403 when shared link has expired', async () => {
      const expiredDate = new Date();
      expiredDate.setFullYear(expiredDate.getFullYear() - 1);

      mockSharedLinkFindUnique.mockResolvedValueOnce({
        id: 'link-expired',
        fileId: 'file-123',
        role: 'viewer',
        expiresAt: expiredDate,
        isActive: true,
      });

      const req = new Request('http://localhost/api/state-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-shared-link-id': 'link-expired',
        },
        body: JSON.stringify({
          path: 'files:getFileById',
          args: { fileId: 'file-123' },
        }),
      });

      const res = await stateSyncPOST(req);
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.error).toContain('link has expired');
    });

    it('should block guest user if trying to access a file mismatching the shared token fileId', async () => {
      mockSharedLinkFindUnique.mockResolvedValueOnce({
        id: 'link-file-123',
        fileId: 'file-123',
        role: 'viewer',
        expiresAt: null,
        isActive: true,
      });

      const req = new Request('http://localhost/api/state-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-shared-link-id': 'link-file-123',
        },
        body: JSON.stringify({
          path: 'files:getFileById',
          args: { fileId: 'secret-file-999' }, // different file!
        }),
      });

      const res = await stateSyncPOST(req);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain('does not grant access to the requested file');
    });
  });

  describe('Scope Restriction', () => {
    it('should allow read-only queries (getFileById) regardless of guest link role', async () => {
      mockSharedLinkFindUnique.mockResolvedValueOnce({
        id: 'link-viewer',
        fileId: 'file-123',
        role: 'viewer',
        expiresAt: null,
        isActive: true,
      });

      mockFileFindUnique.mockResolvedValueOnce({
        id: 'file-123',
        fileName: 'Shared Document',
        document: '[]',
        whiteboard: '[]',
      });

      const req = new Request('http://localhost/api/state-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-shared-link-id': 'link-viewer',
        },
        body: JSON.stringify({
          path: 'files:getFileById',
          args: { _id: 'file-123' },
        }),
      });

      const res = await stateSyncPOST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toBeDefined();
    });

    it('should block writing/mutations (files:updateDocument) for viewer guest role', async () => {
      mockSharedLinkFindUnique.mockResolvedValueOnce({
        id: 'link-viewer',
        fileId: 'file-123',
        role: 'viewer',
        expiresAt: null,
        isActive: true,
      });

      const req = new Request('http://localhost/api/state-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-shared-link-id': 'link-viewer',
        },
        body: JSON.stringify({
          path: 'files:updateDocument',
          args: { fileId: 'file-123', document: '{"blocks":[]}' },
        }),
      });

      const res = await stateSyncPOST(req);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain('does not have write permissions');
    });

    it('should permit writing/mutations (files:updateDocument) for editor guest role', async () => {
      mockSharedLinkFindUnique.mockResolvedValueOnce({
        id: 'link-editor',
        fileId: 'file-123',
        role: 'editor',
        expiresAt: null,
        isActive: true,
      });

      // Stub document update prisma resolution
      mockFileUpdate.mockResolvedValueOnce({
        id: 'file-123',
        document: '{"blocks":[]}',
      });

      const req = new Request('http://localhost/api/state-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-shared-link-id': 'link-editor',
        },
        body: JSON.stringify({
          path: 'files:updateDocument',
          args: { fileId: 'file-123', document: '{"blocks":[]}' },
        }),
      });

      const res = await stateSyncPOST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toBeDefined();
    });
  });

  describe('Revocation Propagation', () => {
    it('should immediately reject active guest sync sessions if the link is marked inactive', async () => {
      mockSharedLinkFindUnique.mockResolvedValueOnce({
        id: 'link-revoked',
        fileId: 'file-123',
        role: 'editor',
        expiresAt: null,
        isActive: false, // marked Inactive / Revoked
      });

      const req = new Request('http://localhost/api/state-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-shared-link-id': 'link-revoked',
        },
        body: JSON.stringify({
          path: 'files:getFileById',
          args: { fileId: 'file-123' },
        }),
      });

      const res = await stateSyncPOST(req);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain('is currently inactive');
    });

    it('should support updating isActive column via POST /api/share', async () => {
      mockGetUser.mockResolvedValueOnce({ email: 'owner@collabpro.com' });
      mockSharedLinkUpdate.mockResolvedValueOnce({
        id: 'link-123',
        fileId: 'file-123',
        role: 'viewer',
        isActive: false,
      });

      const req = new Request('http://localhost/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: 'file-123',
          sharedLinkId: 'link-123',
          role: 'viewer',
          isActive: false,
        }),
      });

      const res = await sharePOST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.isActive).toBe(false);
      expect(mockSharedLinkUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'link-123' },
        data: expect.objectContaining({
          isActive: false,
        }),
      }));
    });
  });
});
