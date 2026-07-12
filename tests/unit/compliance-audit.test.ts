import 'dotenv/config';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/state-sync/route';
import { prisma } from '@/lib/db';

// Mock server-auth and redis-cache
vi.mock('@/lib/session-auth/server', () => {
  return {
    getServerSession: vi.fn().mockReturnValue({
      getUser: vi.fn().mockResolvedValue({ email: 'compliance-auditor@enterprise.com', given_name: 'Auditor' }),
    }),
  };
});

vi.mock('@/lib/redis-cache', () => {
  return {
    getCachedFile: vi.fn(),
    invalidateCachedFile: vi.fn().mockResolvedValue(undefined),
  };
});

describe('Compliance Audit Logging Suite (Issue 10)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Purge database prior to tests execution
    await prisma.auditLog.deleteMany({});
    await prisma.file.deleteMany({});
    await prisma.teamMember.deleteMany({});
    await prisma.team.deleteMany({});
  });

  it('should automatically trigger immutable audit logs when administrative or file deletion events are performed', async () => {
    // 1. Setup a test Team
    const team = await prisma.team.create({
      data: {
        id: 'compliance-team-id',
        teamName: 'SecOps Team',
        createdBy: 'compliance-auditor@enterprise.com',
      },
    });

    // 2. Setup a test File
    const file = await prisma.file.create({
      data: {
        id: 'file-to-be-deleted',
        fileName: 'SuperSecretLeakedInfo.pdf',
        teamId: team.id,
        createdBy: 'compliance-auditor@enterprise.com',
        whiteboard: '',
        document: '',
      },
    });

    // Verify file exists
    const loadedFileBefore = await prisma.file.findUnique({ where: { id: file.id } });
    expect(loadedFileBefore).not.toBeNull();

    // 3. Delete the file through state-sync POST endpoint
    const deleteReq = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'files:deleteFile',
        args: { _id: file.id },
      }),
    });
    // Add real-ip header to test IP recording
    deleteReq.headers.set('x-real-ip', '192.168.1.100');

    const deleteRes = await POST(deleteReq);
    expect(deleteRes.status).toBe(200);

    // Verify file is actually gone
    const loadedFileAfter = await prisma.file.findUnique({ where: { id: file.id } });
    expect(loadedFileAfter).toBeNull();

    // 4. Retrieve the compliance audit log
    const getLogsReq = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'securityAudit:getLogs',
        args: { teamId: team.id },
      }),
    });
    const getLogsRes = await POST(getLogsReq);
    expect(getLogsRes.status).toBe(200);
    const logs = (await getLogsRes.json()).data;

    // Verify log details are immutable and recorded correctly
    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe('file:delete');
    expect(logs[0].userEmail).toBe('compliance-auditor@enterprise.com');
    expect(logs[0].ipAddress).toBe('192.168.1.100');
    expect(logs[0].context).toContain('SuperSecretLeakedInfo.pdf');
  });

  it('should log security events when team policy settings are modified', async () => {
    const team = await prisma.team.create({
      data: {
        id: 'compliance-team-settings-id',
        teamName: 'Enterprise Org Settings',
        createdBy: 'compliance-auditor@enterprise.com',
      },
    });

    // Update settings via POST state-sync API
    const updateReq = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'orgSettings:updateSettings',
        args: {
          teamId: team.id,
          allowedDomains: 'acme.com',
          ssoEnabled: true,
          seatLimit: 25,
        },
      }),
    });
    updateReq.headers.set('x-forwarded-for', '10.0.0.1');
    const updateRes = await POST(updateReq);
    expect(updateRes.status).toBe(200);

    // Retrieve logs
    const logs = await prisma.auditLog.findMany({
      where: { teamId: team.id },
    });
    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe('settings:update');
    expect(logs[0].ipAddress).toBe('10.0.0.1');
    expect(logs[0].context).toContain('acme.com');
    expect(logs[0].context).toContain('true');
  });
});
