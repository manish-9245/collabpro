import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as stateSyncPOST } from '@/app/api/state-sync/route';

// Mock database prisma
const mockTeamFindUnique = vi.fn();
const mockTeamDelete = vi.fn();
const mockFileFindUnique = vi.fn();
const mockFileFindMany = vi.fn();
const mockFileDelete = vi.fn();
const mockFileDeleteMany = vi.fn();
const mockFileVersionDeleteMany = vi.fn();
const mockFilePresenceDeleteMany = vi.fn();
const mockSharedLinkDeleteMany = vi.fn();
const mockTeamMemberDeleteMany = vi.fn();
const mockInvitationDeleteMany = vi.fn();
const mockSharedLibraryItemDeleteMany = vi.fn();
const mockTeamMemberDelete = vi.fn();
const mockNotificationCreate = vi.fn();
const mockAuditLogCreate = vi.fn();

vi.mock('@/lib/db', () => {
  const mockPrisma = {
    $transaction: async (cb: any) => cb(mockPrisma),
    team: {
      findUnique: (...args: any[]) => mockTeamFindUnique(...args),
      delete: (...args: any[]) => mockTeamDelete(...args),
    },
    file: {
      findUnique: (...args: any[]) => mockFileFindUnique(...args),
      findMany: (...args: any[]) => mockFileFindMany(...args),
      delete: (...args: any[]) => mockFileDelete(...args),
      deleteMany: (...args: any[]) => mockFileDeleteMany(...args),
    },
    fileVersion: {
      deleteMany: (...args: any[]) => mockFileVersionDeleteMany(...args),
    },
    filePresence: {
      deleteMany: (...args: any[]) => mockFilePresenceDeleteMany(...args),
    },
    sharedLink: {
      deleteMany: (...args: any[]) => mockSharedLinkDeleteMany(...args),
    },
    teamMember: {
      deleteMany: (...args: any[]) => mockTeamMemberDeleteMany(...args),
      delete: (...args: any[]) => mockTeamMemberDelete(...args),
    },
    invitation: {
      deleteMany: (...args: any[]) => mockInvitationDeleteMany(...args),
    },
    sharedLibraryItem: {
      deleteMany: (...args: any[]) => mockSharedLibraryItemDeleteMany(...args),
    },
    notification: {
      create: (...args: any[]) => mockNotificationCreate(...args),
    },
    auditLog: {
      create: (...args: any[]) => mockAuditLogCreate(...args),
    },
  };
  return { prisma: mockPrisma };
});

const mockGetUser = vi.fn();
vi.mock('@/lib/session-auth/server', () => ({
  getServerSession: () => ({
    getUser: mockGetUser,
  }),
}));

describe('Relational Database Cascading Deletion Verification Suite (Issue 59)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ email: 'owner@example.com', name: 'Owner' });
    mockTeamMemberDeleteMany.mockResolvedValue({ count: 1 });
  });

  it('should verify Team Space Demolition cascade rules', async () => {
    const teamId = 'team-123';
    const ownerEmail = 'owner@example.com';

    // Configure mocks
    mockTeamFindUnique.mockResolvedValue({
      id: teamId,
      teamName: 'Demolition Team',
      createdBy: ownerEmail,
    });

    mockFileFindMany.mockResolvedValue([
      { id: 'file-1' },
      { id: 'file-2' },
    ]);

    const req = {
      json: async () => ({
        path: 'teams:deleteTeam',
        args: { teamId, ownerEmail },
      }),
    } as unknown as Request;

    const response = await stateSyncPOST(req);
    const result = await response.json();

    expect(response.status).toBe(200);

    // 1. Verify files belonging to team were queried
    expect(mockFileFindMany).toHaveBeenCalledWith({
      where: { teamId },
    });

    // 2. Verify all file-dependent records are cleanly cascade deleted
    expect(mockFileVersionDeleteMany).toHaveBeenCalledWith({
      where: { fileId: { in: ['file-1', 'file-2'] } },
    });
    expect(mockFilePresenceDeleteMany).toHaveBeenCalledWith({
      where: { fileId: { in: ['file-1', 'file-2'] } },
    });
    expect(mockSharedLinkDeleteMany).toHaveBeenCalledWith({
      where: { fileId: { in: ['file-1', 'file-2'] } },
    });
    expect(mockFileDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['file-1', 'file-2'] } },
    });

    // 3. Verify team dependencies are deleted
    expect(mockTeamMemberDeleteMany).toHaveBeenCalledWith({
      where: { teamId },
    });
    expect(mockInvitationDeleteMany).toHaveBeenCalledWith({
      where: { teamId },
    });
    expect(mockSharedLibraryItemDeleteMany).toHaveBeenCalledWith({
      where: { teamId },
    });

    // 4. Verify team itself is deleted
    expect(mockTeamDelete).toHaveBeenCalledWith({
      where: { id: teamId },
    });
  });

  it('should verify Board-to-Nodes Cascade rules when deleting a file', async () => {
    const fileId = 'file-123';
    mockFileFindUnique.mockResolvedValue({
      id: fileId,
      fileName: 'Test File',
      teamId: 'team-123',
      createdBy: 'owner@example.com',
    });

    const req = {
      json: async () => ({
        path: 'files:deleteFile',
        args: { _id: fileId },
      }),
    } as unknown as Request;

    const response = await stateSyncPOST(req);
    expect(response.status).toBe(200);

    // Verify all file history and sharing scopes cascade delete with file
    expect(mockFileVersionDeleteMany).toHaveBeenCalledWith({
      where: { fileId },
    });
    expect(mockFilePresenceDeleteMany).toHaveBeenCalledWith({
      where: { fileId },
    });
    expect(mockSharedLinkDeleteMany).toHaveBeenCalledWith({
      where: { fileId },
    });
    expect(mockFileDelete).toHaveBeenCalledWith({
      where: { id: fileId },
    });
  });

  it('should verify User Disassociation revokes board membership but preserves authorships', async () => {
    const teamId = 'team-123';
    const userEmail = 'member@example.com';
    const ownerEmail = 'owner@example.com';

    mockTeamFindUnique.mockResolvedValue({
      id: teamId,
      createdBy: ownerEmail,
    });

    const req = {
      json: async () => ({
        path: 'teams:removeMember',
        args: { teamId, userEmail, ownerEmail },
      }),
    } as unknown as Request;

    const response = await stateSyncPOST(req);
    expect(response.status).toBe(200);

    // Verify user is removed from team member records (access revoked)
    expect(mockTeamMemberDeleteMany).toHaveBeenCalledWith({
      where: { teamId, userEmail },
    });

    // Ensure authored file history versions are preserved intact and never deleted
    expect(mockFileVersionDeleteMany).not.toHaveBeenCalled();
  });
});
