import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import { POST as stateSyncPOST } from '@/app/api/state-sync/route';
import { POST as sharePOST, GET as shareGET, DELETE as shareDELETE } from '@/app/api/share/route';
import { POST as verifyPOST } from '@/app/api/share/verify/route';
import { checkFileAccess } from '@/lib/file-access';

// Mock database prisma
const mockSharedLinkFindUnique = vi.fn();
const mockSharedLinkFindMany = vi.fn();
const mockSharedLinkCreate = vi.fn();
const mockSharedLinkUpdate = vi.fn();
const mockSharedLinkUpdateMany = vi.fn();
const mockSharedLinkDelete = vi.fn();
const mockSharedLinkDeleteMany = vi.fn();

const mockFileFindUnique = vi.fn();
const mockFileUpdate = vi.fn();
const mockFileUpdateMany = vi.fn();

const mockTeamMemberFindFirst = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    sharedLink: {
      findUnique: (...args: any[]) => mockSharedLinkFindUnique(...args),
      findMany: (...args: any[]) => mockSharedLinkFindMany(...args),
      create: (...args: any[]) => mockSharedLinkCreate(...args),
      update: (...args: any[]) => mockSharedLinkUpdate(...args),
      updateMany: (...args: any[]) => mockSharedLinkUpdateMany(...args),
      delete: (...args: any[]) => mockSharedLinkDelete(...args),
      deleteMany: (...args: any[]) => mockSharedLinkDeleteMany(...args),
    },
    file: {
      findUnique: (...args: any[]) => mockFileFindUnique(...args),
      update: (...args: any[]) => mockFileUpdate(...args),
      // files:updateDocument / files:updateWhiteboard write via a
      // compare-and-swap prisma.file.updateMany (issue #197 partial).
      updateMany: (...args: any[]) => mockFileUpdateMany(...args),
    },
    teamMember: {
      findFirst: (...args: any[]) => mockTeamMemberFindFirst(...args),
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

      // casUpdateDocument reads the file first (to build the CAS predicate
      // from its exact raw current value) before writing it.
      mockFileFindUnique.mockResolvedValueOnce({
        id: 'file-123',
        document: '{"blocks":[]}',
      });
      // Stub the compare-and-swap document update prisma resolution
      mockFileUpdateMany.mockResolvedValueOnce({ count: 1 });

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
      mockSharedLinkFindUnique.mockResolvedValueOnce({
        id: 'link-123',
        fileId: 'file-123',
        role: 'viewer',
      });
      mockFileFindUnique.mockResolvedValueOnce({
        id: 'file-123',
        createdBy: 'owner@collabpro.com',
        teamId: 'team-1',
      });
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

describe('File Authorization for Share Links (Issue 183)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue(null);
  });

  describe('POST /api/share (create)', () => {
    it('returns 403 when the caller has no relationship to the file', async () => {
      mockGetUser.mockResolvedValueOnce({ email: 'stranger@collabpro.com' });
      mockFileFindUnique.mockResolvedValueOnce({ id: 'file-1', createdBy: 'owner@collabpro.com', teamId: 'team-1' });
      mockTeamMemberFindFirst.mockResolvedValueOnce(null);

      const req = new Request('http://localhost/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: 'file-1', role: 'editor' }),
      });

      const res = await sharePOST(req);
      expect(res.status).toBe(403);
      expect(mockSharedLinkCreate).not.toHaveBeenCalled();
    });

    it('allows the file owner to create a link', async () => {
      mockGetUser.mockResolvedValueOnce({ email: 'owner@collabpro.com' });
      mockFileFindUnique.mockResolvedValueOnce({ id: 'file-1', createdBy: 'owner@collabpro.com', teamId: 'team-1' });
      mockSharedLinkCreate.mockResolvedValueOnce({ id: 'link-new', fileId: 'file-1', role: 'editor', passwordHash: null, isActive: true });

      const req = new Request('http://localhost/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: 'file-1', role: 'editor' }),
      });

      const res = await sharePOST(req);
      expect(res.status).toBe(200);
      expect(mockSharedLinkCreate).toHaveBeenCalled();
    });

    it('allows a team member of the file team to create a link', async () => {
      mockGetUser.mockResolvedValueOnce({ email: 'member@collabpro.com' });
      mockFileFindUnique.mockResolvedValueOnce({ id: 'file-1', createdBy: 'owner@collabpro.com', teamId: 'team-1' });
      mockTeamMemberFindFirst.mockResolvedValueOnce({ id: 'tm-1', teamId: 'team-1', userEmail: 'member@collabpro.com' });
      mockSharedLinkCreate.mockResolvedValueOnce({ id: 'link-new', fileId: 'file-1', role: 'viewer', passwordHash: null, isActive: true });

      const req = new Request('http://localhost/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: 'file-1', role: 'viewer' }),
      });

      const res = await sharePOST(req);
      expect(res.status).toBe(200);
      expect(mockSharedLinkCreate).toHaveBeenCalled();
    });
  });

  describe('POST /api/share (update existing link)', () => {
    it('returns 403 when the caller has no relationship to the file, ignoring a spoofed fileId in the body', async () => {
      mockGetUser.mockResolvedValueOnce({ email: 'stranger@collabpro.com' });
      mockSharedLinkFindUnique.mockResolvedValueOnce({ id: 'link-1', fileId: 'file-real', role: 'viewer' });
      mockFileFindUnique.mockResolvedValueOnce({ id: 'file-real', createdBy: 'owner@collabpro.com', teamId: 'team-1' });
      mockTeamMemberFindFirst.mockResolvedValueOnce(null);

      const req = new Request('http://localhost/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // fileId here is a lie: the real link belongs to file-real, not file-spoofed
        body: JSON.stringify({ fileId: 'file-spoofed', sharedLinkId: 'link-1', role: 'editor' }),
      });

      const res = await sharePOST(req);
      expect(res.status).toBe(403);
      expect(mockSharedLinkUpdate).not.toHaveBeenCalled();
      // Authorization must have been checked against the link's real fileId, not the body's
      expect(mockFileFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'file-real' } }));
    });

    it('returns 403 when the referenced sharedLinkId does not exist', async () => {
      mockGetUser.mockResolvedValueOnce({ email: 'owner@collabpro.com' });
      mockSharedLinkFindUnique.mockResolvedValueOnce(null);

      const req = new Request('http://localhost/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: 'file-real', sharedLinkId: 'missing-link', role: 'editor' }),
      });

      const res = await sharePOST(req);
      expect(res.status).toBe(403);
      expect(mockSharedLinkUpdate).not.toHaveBeenCalled();
    });

    it('allows the file owner to update an existing link', async () => {
      mockGetUser.mockResolvedValueOnce({ email: 'owner@collabpro.com' });
      mockSharedLinkFindUnique.mockResolvedValueOnce({ id: 'link-1', fileId: 'file-real', role: 'viewer' });
      mockFileFindUnique.mockResolvedValueOnce({ id: 'file-real', createdBy: 'owner@collabpro.com', teamId: 'team-1' });
      mockSharedLinkUpdate.mockResolvedValueOnce({ id: 'link-1', fileId: 'file-real', role: 'editor', isActive: true });

      const req = new Request('http://localhost/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: 'file-real', sharedLinkId: 'link-1', role: 'editor' }),
      });

      const res = await sharePOST(req);
      expect(res.status).toBe(200);
      expect(mockSharedLinkUpdate).toHaveBeenCalled();
    });

    it('allows a team member of the file team to update an existing link', async () => {
      mockGetUser.mockResolvedValueOnce({ email: 'member@collabpro.com' });
      mockSharedLinkFindUnique.mockResolvedValueOnce({ id: 'link-1', fileId: 'file-real', role: 'viewer' });
      mockFileFindUnique.mockResolvedValueOnce({ id: 'file-real', createdBy: 'owner@collabpro.com', teamId: 'team-1' });
      mockTeamMemberFindFirst.mockResolvedValueOnce({ id: 'tm-1', teamId: 'team-1', userEmail: 'member@collabpro.com' });
      mockSharedLinkUpdate.mockResolvedValueOnce({ id: 'link-1', fileId: 'file-real', role: 'editor', isActive: true });

      const req = new Request('http://localhost/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: 'file-real', sharedLinkId: 'link-1', role: 'editor' }),
      });

      const res = await sharePOST(req);
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/share?fileId=', () => {
    it('returns 403 when the caller has no relationship to the file', async () => {
      mockGetUser.mockResolvedValueOnce({ email: 'stranger@collabpro.com' });
      mockFileFindUnique.mockResolvedValueOnce({ id: 'file-1', createdBy: 'owner@collabpro.com', teamId: 'team-1' });
      mockTeamMemberFindFirst.mockResolvedValueOnce(null);

      const req = new Request('http://localhost/api/share?fileId=file-1', { method: 'GET' });
      const res = await shareGET(req);
      expect(res.status).toBe(403);
      expect(mockSharedLinkFindMany).not.toHaveBeenCalled();
    });

    it('allows the file owner to list links for their file', async () => {
      mockGetUser.mockResolvedValueOnce({ email: 'owner@collabpro.com' });
      mockFileFindUnique.mockResolvedValueOnce({ id: 'file-1', createdBy: 'owner@collabpro.com', teamId: 'team-1' });
      mockSharedLinkFindMany.mockResolvedValueOnce([]);

      const req = new Request('http://localhost/api/share?fileId=file-1', { method: 'GET' });
      const res = await shareGET(req);
      expect(res.status).toBe(200);
    });

    it('allows a team member of the file team to list links', async () => {
      mockGetUser.mockResolvedValueOnce({ email: 'member@collabpro.com' });
      mockFileFindUnique.mockResolvedValueOnce({ id: 'file-1', createdBy: 'owner@collabpro.com', teamId: 'team-1' });
      mockTeamMemberFindFirst.mockResolvedValueOnce({ id: 'tm-1', teamId: 'team-1', userEmail: 'member@collabpro.com' });
      mockSharedLinkFindMany.mockResolvedValueOnce([]);

      const req = new Request('http://localhost/api/share?fileId=file-1', { method: 'GET' });
      const res = await shareGET(req);
      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/share?sharedLinkId=', () => {
    it('returns 403 when the caller has no relationship to the file', async () => {
      mockGetUser.mockResolvedValueOnce({ email: 'stranger@collabpro.com' });
      mockSharedLinkFindUnique.mockResolvedValueOnce({ id: 'link-1', fileId: 'file-real' });
      mockFileFindUnique.mockResolvedValueOnce({ id: 'file-real', createdBy: 'owner@collabpro.com', teamId: 'team-1' });
      mockTeamMemberFindFirst.mockResolvedValueOnce(null);

      const req = new Request('http://localhost/api/share?sharedLinkId=link-1', { method: 'DELETE' });
      const res = await shareDELETE(req);
      expect(res.status).toBe(403);
      expect(mockSharedLinkDelete).not.toHaveBeenCalled();
    });

    it('allows the file owner to delete a link', async () => {
      mockGetUser.mockResolvedValueOnce({ email: 'owner@collabpro.com' });
      mockSharedLinkFindUnique.mockResolvedValueOnce({ id: 'link-1', fileId: 'file-real' });
      mockFileFindUnique.mockResolvedValueOnce({ id: 'file-real', createdBy: 'owner@collabpro.com', teamId: 'team-1' });
      mockSharedLinkDeleteMany.mockResolvedValueOnce({ count: 1 });

      const req = new Request('http://localhost/api/share?sharedLinkId=link-1', { method: 'DELETE' });
      const res = await shareDELETE(req);
      expect(res.status).toBe(200);
    });

    it('allows a team member of the file team to delete a link', async () => {
      mockGetUser.mockResolvedValueOnce({ email: 'member@collabpro.com' });
      mockSharedLinkFindUnique.mockResolvedValueOnce({ id: 'link-1', fileId: 'file-real' });
      mockFileFindUnique.mockResolvedValueOnce({ id: 'file-real', createdBy: 'owner@collabpro.com', teamId: 'team-1' });
      mockTeamMemberFindFirst.mockResolvedValueOnce({ id: 'tm-1', teamId: 'team-1', userEmail: 'member@collabpro.com' });
      mockSharedLinkDeleteMany.mockResolvedValueOnce({ count: 1 });

      const req = new Request('http://localhost/api/share?sharedLinkId=link-1', { method: 'DELETE' });
      const res = await shareDELETE(req);
      expect(res.status).toBe(200);
    });

    it('does not throw when the link was already deleted concurrently (idempotent delete)', async () => {
      mockGetUser.mockResolvedValueOnce({ email: 'owner@collabpro.com' });
      mockSharedLinkFindUnique.mockResolvedValueOnce({ id: 'link-gone', fileId: 'file-real' });
      mockFileFindUnique.mockResolvedValueOnce({ id: 'file-real', createdBy: 'owner@collabpro.com', teamId: 'team-1' });
      // Someone else revoked it a moment earlier: 0 rows matched, not an error.
      mockSharedLinkDeleteMany.mockResolvedValueOnce({ count: 0 });

      const req = new Request('http://localhost/api/share?sharedLinkId=link-gone', { method: 'DELETE' });
      const res = await shareDELETE(req);
      expect(res.status).toBe(200);
      expect(mockSharedLinkDelete).not.toHaveBeenCalled();
      expect(mockSharedLinkDeleteMany).toHaveBeenCalledWith({ where: { id: 'link-gone' } });
    });
  });
});

describe('checkFileAccess team ownership (Issue 183 follow-up)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true for a team owner who did not personally create the file', async () => {
    mockFileFindUnique.mockResolvedValueOnce({
      id: 'file-9',
      createdBy: 'teammate@collabpro.com',
      teamId: 'team-9',
      team: { id: 'team-9', createdBy: 'owner@collabpro.com' },
    });
    mockTeamMemberFindFirst.mockResolvedValueOnce(null); // owner has no TeamMember row either

    const result = await checkFileAccess('file-9', 'owner@collabpro.com');
    expect(result).toBe(true);
  });

  it('returns false for a stranger who is neither the file creator, team owner, nor a team member', async () => {
    mockFileFindUnique.mockResolvedValueOnce({
      id: 'file-9',
      createdBy: 'teammate@collabpro.com',
      teamId: 'team-9',
      team: { id: 'team-9', createdBy: 'owner@collabpro.com' },
    });
    mockTeamMemberFindFirst.mockResolvedValueOnce(null);

    const result = await checkFileAccess('file-9', 'stranger@collabpro.com');
    expect(result).toBe(false);
  });

  it('allows the team owner to create a share link for a file a teammate created', async () => {
    mockGetUser.mockResolvedValueOnce({ email: 'team-owner@collabpro.com' });
    mockFileFindUnique.mockResolvedValueOnce({
      id: 'file-10',
      createdBy: 'teammate@collabpro.com',
      teamId: 'team-10',
      team: { id: 'team-10', createdBy: 'team-owner@collabpro.com' },
    });
    mockTeamMemberFindFirst.mockResolvedValueOnce(null);
    mockSharedLinkCreate.mockResolvedValueOnce({ id: 'link-new', fileId: 'file-10', role: 'viewer', passwordHash: null, isActive: true });

    const req = new Request('http://localhost/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: 'file-10', role: 'viewer' }),
    });

    const res = await sharePOST(req);
    expect(res.status).toBe(200);
  });
});

describe('Revoked Link Rejection at Verify (Issue 184 follow-up)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects verification of a revoked (isActive: false) link even with the correct password', async () => {
    const correctHash = await bcrypt.hash('correct-pw', 10);
    mockSharedLinkFindUnique.mockResolvedValueOnce({
      id: 'link-revoked',
      fileId: 'file-1',
      role: 'editor',
      passwordHash: correctHash,
      expiresAt: null,
      isActive: false,
    });

    const req = new Request('http://localhost/api/share/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sharedLinkId: 'link-revoked', password: 'correct-pw' }),
    });

    const res = await verifyPOST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).not.toBe(true);
  });

  it('still allows verification of an active link with the correct password', async () => {
    const correctHash = await bcrypt.hash('correct-pw', 10);
    mockSharedLinkFindUnique.mockResolvedValueOnce({
      id: 'link-active',
      fileId: 'file-1',
      role: 'editor',
      passwordHash: correctHash,
      expiresAt: null,
      isActive: true,
    });

    const req = new Request('http://localhost/api/share/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sharedLinkId: 'link-active', password: 'correct-pw' }),
    });

    const res = await verifyPOST(req);
    expect(res.status).toBe(200);
  });
});

describe('Password Upgrade Race Condition (Issue 184 follow-up)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not clobber a concurrently-changed password when upgrading a legacy hash', async () => {
    const legacyHash = createHash('sha256').update('legacy-pass').digest('hex');
    mockSharedLinkFindUnique.mockResolvedValueOnce({
      id: 'link-race',
      fileId: 'file-1',
      role: 'viewer',
      passwordHash: legacyHash,
      expiresAt: null,
      isActive: true,
    });

    // Simulate: by the time the upgrade write runs, the row's passwordHash
    // is no longer `legacyHash` (owner changed the password concurrently
    // via POST /api/share). A conditional update matched 0 rows.
    mockSharedLinkUpdateMany.mockResolvedValueOnce({ count: 0 });

    const req = new Request('http://localhost/api/share/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sharedLinkId: 'link-race', password: 'legacy-pass' }),
    });

    const res = await verifyPOST(req);
    // The verify itself still succeeds against the hash the user actually typed.
    expect(res.status).toBe(200);
    // The upgrade write must be conditional on the hash unchanged, not a blind update-by-id.
    expect(mockSharedLinkUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'link-race', passwordHash: legacyHash },
    }));
    expect(mockSharedLinkUpdate).not.toHaveBeenCalled();
  });

  it('upgrades the hash normally when there is no concurrent change', async () => {
    const legacyHash = createHash('sha256').update('legacy-pass-2').digest('hex');
    mockSharedLinkFindUnique.mockResolvedValueOnce({
      id: 'link-no-race',
      fileId: 'file-1',
      role: 'viewer',
      passwordHash: legacyHash,
      expiresAt: null,
      isActive: true,
    });
    mockSharedLinkUpdateMany.mockResolvedValueOnce({ count: 1 });

    const req = new Request('http://localhost/api/share/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sharedLinkId: 'link-no-race', password: 'legacy-pass-2' }),
    });

    const res = await verifyPOST(req);
    expect(res.status).toBe(200);
    expect(mockSharedLinkUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'link-no-race', passwordHash: legacyHash },
      data: expect.objectContaining({ passwordHash: expect.stringMatching(/^\$2/) }),
    }));
  });
});

describe('Rate Limit Key Construction (Issue 184 follow-up)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue(null);
  });

  it('does not let one attacker exhausting bad-password attempts against a link block a different visitor from verifying with the correct password on that same link', async () => {
    const correctHash = await bcrypt.hash('correct-pw', 10);
    mockSharedLinkFindUnique.mockResolvedValue({
      id: 'link-shared',
      fileId: 'file-1',
      role: 'viewer',
      passwordHash: correctHash,
      expiresAt: null,
      isActive: true,
    });

    const attackerReq = () => new Request('http://localhost/api/share/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify({ sharedLinkId: 'link-shared', password: 'wrong-pass' }),
    });
    // Attacker exhausts the per-(link, ip) bucket for their own IP.
    for (let i = 0; i < 10; i++) {
      await verifyPOST(attackerReq());
    }

    // A different visitor, different IP, correct password, same link.
    const victimReq = new Request('http://localhost/api/share/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.42' },
      body: JSON.stringify({ sharedLinkId: 'link-shared', password: 'correct-pw' }),
    });
    const victimRes = await verifyPOST(victimReq);
    expect(victimRes.status).toBe(200);
  });

  it('cannot be bypassed by rotating the client-supplied IP for a fixed sharedLinkId — the per-link ceiling still catches a distributed attempt', async () => {
    mockSharedLinkFindUnique.mockResolvedValue({
      id: 'link-ip-rotate',
      fileId: 'file-1',
      role: 'viewer',
      passwordHash: null,
      expiresAt: null,
      isActive: true,
    });

    const makeReq = (ip: string) => new Request('http://localhost/api/share/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ sharedLinkId: 'link-ip-rotate', password: 'wrong-pass' }),
    });

    // Rotating IP defeats the per-(link, ip) bucket (each new IP gets a
    // fresh one), but the per-link-only ceiling (60/15min) still bounds the
    // total across all of them.
    let lastRes;
    for (let i = 0; i < 61; i++) {
      lastRes = await verifyPOST(makeReq(`203.0.113.${i}`));
    }

    expect(lastRes!.status).toBe(429);
  });

  it('does not let one exhausted link block verification attempts against a different link from the same IP', async () => {
    mockSharedLinkFindUnique.mockResolvedValue({
      id: 'link-a',
      fileId: 'file-1',
      role: 'viewer',
      passwordHash: null,
      expiresAt: null,
      isActive: true,
    });

    const makeReqA = () => new Request('http://localhost/api/share/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.1' },
      body: JSON.stringify({ sharedLinkId: 'link-a', password: 'wrong-pass' }),
    });
    for (let i = 0; i < 10; i++) {
      await verifyPOST(makeReqA());
    }

    mockSharedLinkFindUnique.mockResolvedValueOnce({
      id: 'link-b',
      fileId: 'file-2',
      role: 'viewer',
      passwordHash: null,
      expiresAt: null,
      isActive: true,
    });
    const reqB = new Request('http://localhost/api/share/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.1' },
      body: JSON.stringify({ sharedLinkId: 'link-b', password: 'wrong-pass' }),
    });
    const resB = await verifyPOST(reqB);
    expect(resB.status).not.toBe(429);
  });

  it('does not consume a rate-limit bucket for a sharedLinkId that does not exist in the database', async () => {
    mockSharedLinkFindUnique.mockResolvedValue(null);

    const makeReq = () => new Request('http://localhost/api/share/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.9' },
      body: JSON.stringify({ sharedLinkId: 'does-not-exist', password: 'whatever' }),
    });

    for (let i = 0; i < 15; i++) {
      const res = await verifyPOST(makeReq());
      expect(res.status).toBe(404);
    }
  });
});

describe('Password Hashing for Share Links (Issue 184)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue(null);
  });

  it('creates a new share link with a bcrypt password hash ($2 prefix), not raw SHA-256', async () => {
    mockGetUser.mockResolvedValueOnce({ email: 'owner@collabpro.com' });
    mockFileFindUnique.mockResolvedValueOnce({ id: 'file-1', createdBy: 'owner@collabpro.com', teamId: 'team-1' });
    mockSharedLinkCreate.mockImplementationOnce(async ({ data }: any) => ({ id: 'link-new', ...data }));

    const req = new Request('http://localhost/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: 'file-1', role: 'viewer', password: 'super-secret-pw' }),
    });

    const res = await sharePOST(req);
    expect(res.status).toBe(200);
    expect(mockSharedLinkCreate).toHaveBeenCalled();
    const createArg = mockSharedLinkCreate.mock.calls[0][0];
    expect(createArg.data.passwordHash).toMatch(/^\$2/);
    // Must not be a bare SHA-256 hex digest
    expect(createArg.data.passwordHash).not.toMatch(/^[a-f0-9]{64}$/i);
  });

  it('verifies successfully against a legacy SHA-256 hash and upgrades the row to bcrypt afterward', async () => {
    const legacyHash = createHash('sha256').update('legacy-pass').digest('hex');
    mockSharedLinkFindUnique.mockResolvedValueOnce({
      id: 'link-legacy',
      fileId: 'file-1',
      role: 'viewer',
      passwordHash: legacyHash,
      expiresAt: null,
      isActive: true,
    });
    mockSharedLinkUpdateMany.mockResolvedValueOnce({ count: 1 });

    const req = new Request('http://localhost/api/share/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sharedLinkId: 'link-legacy', password: 'legacy-pass' }),
    });

    const res = await verifyPOST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // The legacy row must be transparently upgraded to a bcrypt hash post-verify
    expect(mockSharedLinkUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'link-legacy', passwordHash: legacyHash },
      data: expect.objectContaining({
        passwordHash: expect.stringMatching(/^\$2/),
      }),
    }));
  });

  it('rejects an incorrect password against a legacy SHA-256 hash without upgrading it', async () => {
    const legacyHash = createHash('sha256').update('legacy-pass').digest('hex');
    mockSharedLinkFindUnique.mockResolvedValueOnce({
      id: 'link-legacy-2',
      fileId: 'file-1',
      role: 'viewer',
      passwordHash: legacyHash,
      expiresAt: null,
      isActive: true,
    });

    const req = new Request('http://localhost/api/share/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sharedLinkId: 'link-legacy-2', password: 'wrong-pass' }),
    });

    const res = await verifyPOST(req);
    expect(res.status).toBe(401);
    expect(mockSharedLinkUpdate).not.toHaveBeenCalled();
    expect(mockSharedLinkUpdateMany).not.toHaveBeenCalled();
  });
});

describe('Rate Limiting for Share Verify (Issue 184)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue(null);
  });

  it('returns 429 with a Retry-After header once the attempt limit is exceeded', async () => {
    mockSharedLinkFindUnique.mockResolvedValue({
      id: 'link-throttle',
      fileId: 'file-1',
      role: 'viewer',
      passwordHash: null,
      expiresAt: null,
    });

    const makeReq = () => new Request('http://localhost/api/share/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.5' },
      body: JSON.stringify({ sharedLinkId: 'link-throttle', password: 'wrong-pass' }),
    });

    let lastRes;
    for (let i = 0; i < 11; i++) {
      lastRes = await verifyPOST(makeReq());
    }

    expect(lastRes!.status).toBe(429);
    expect(lastRes!.headers.get('Retry-After')).toBeTruthy();
  });
});
