import 'dotenv/config';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/state-sync/route';
import { prisma } from '@/lib/db';
import { triggerQueryRefetch } from '@/lib/state-sync/react';

// Mock server-auth and redis-cache
vi.mock('@/lib/session-auth/server', () => {
  return {
    getServerSession: vi.fn().mockReturnValue({
      getUser: vi.fn().mockResolvedValue({ email: 'user@example.com', given_name: 'Test User' }),
    }),
  };
});

vi.mock('@/lib/redis-cache', () => {
  return {
    getCachedFile: vi.fn(),
    invalidateCachedFile: vi.fn().mockResolvedValue(undefined),
  };
});

describe('Workspace Version History Side-Drawer API Suite (Issue 8)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Clean tables before tests
    await prisma.fileVersion.deleteMany({});
    await prisma.file.deleteMany({});
    await prisma.team.deleteMany({});

    // Create parent Team to satisfy referential integrity constraints
    await prisma.team.create({
      data: {
        id: "team-ver-test",
        teamName: "Version Control Test Team",
        createdBy: "user@example.com",
      },
    });
  });

  it('should successfully create, fetch, and restore file checkpoints', async () => {
    // 1. Create a dummy file
    const file = await prisma.file.create({
      data: {
        id: 'file-ver-test',
        fileName: 'TDD Document',
        teamId: 'team-ver-test',
        createdBy: 'user@example.com',
        document: '{"blocks": [{"type": "paragraph", "data": {"text": "Initial Draft"}}]}',
        whiteboard: '[]',
      },
    });

    // 2. Create version 1 via api
    const createReq = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'files:createVersion',
        args: {
          fileId: file.id,
          createdByName: 'Test User',
          createdByImage: 'http://avatar.url',
          note: 'v1.0 Approved Blueprint',
        },
      }),
    });
    
    const createRes = await POST(createReq);
    expect(createRes.status).toBe(200);
    const createdVer = (await createRes.json()).data;
    expect(createdVer.version).toBe(1);
    expect(createdVer.note).toBe('v1.0 Approved Blueprint');
    expect(createdVer.document).toContain('Initial Draft');

    // 3. Modify the original file to simulate direct edit
    await prisma.file.update({
      where: { id: file.id },
      data: {
        document: '{"blocks": [{"type": "paragraph", "data": {"text": "Version 2 Work in progress"}}]}',
      },
    });

    // 4. Fetch checkpoints
    const getReq = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'files:getVersions',
        args: { fileId: file.id },
      }),
    });
    const getRes = await POST(getReq);
    expect(getRes.status).toBe(200);
    const versionsPage = (await getRes.json()).data;
    expect(versionsPage.items.length).toBe(1);
    expect(versionsPage.items[0].version).toBe(1);

    // 5. Update note of checkpoint
    const updateNoteReq = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'files:updateVersionNote',
        args: {
          versionId: createdVer.id,
          note: 'v1.0 Officially Approved Blueprint',
        },
      }),
    });
    const updateNoteRes = await POST(updateNoteReq);
    expect(updateNoteRes.status).toBe(200);
    
    const updatedVerInDb = await prisma.fileVersion.findUnique({
      where: { id: createdVer.id },
    });
    expect(updatedVerInDb?.note).toBe('v1.0 Officially Approved Blueprint');

    // 6. Restore back to version 1
    const restoreReq = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'files:restoreVersion',
        args: { versionId: createdVer.id },
      }),
    });
    const restoreRes = await POST(restoreReq);
    expect(restoreRes.status).toBe(200);

    const restoredFileInDb = await prisma.file.findUnique({
      where: { id: file.id },
    });
    // Document should have reverted back to "Initial Draft"
    expect(restoredFileInDb?.document).toContain('Initial Draft');
  });

  it('should not include document or whiteboard blobs in the files:getVersions list response (Issue 200)', async () => {
    const file = await prisma.file.create({
      data: {
        id: 'file-ver-noblobs',
        fileName: 'No Blobs Document',
        teamId: 'team-ver-test',
        createdBy: 'user@example.com',
        document: '{"blocks": [{"type": "paragraph", "data": {"text": "Sensitive full content"}}]}',
        whiteboard: '[{"id":"el1","type":"rectangle"}]',
      },
    });

    const createReq = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'files:createVersion',
        args: { fileId: file.id, createdByName: 'Test User', note: 'checkpoint' },
      }),
    });
    await POST(createReq);

    const getReq = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({ path: 'files:getVersions', args: { fileId: file.id } }),
    });
    const getRes = await POST(getReq);
    expect(getRes.status).toBe(200);
    const versionsPage = (await getRes.json()).data;

    expect(versionsPage.items.length).toBe(1);
    for (const item of versionsPage.items) {
      expect(item).not.toHaveProperty('document');
      expect(item).not.toHaveProperty('whiteboard');
      // Metadata fields must still be present
      expect(item).toHaveProperty('version');
      expect(item).toHaveProperty('createdAt');
      expect(item).toHaveProperty('note');
    }
  });

  it('should return the full document and whiteboard for a single version when versionId is supplied, for restore/preview (Issue 200)', async () => {
    const file = await prisma.file.create({
      data: {
        id: 'file-ver-single',
        fileName: 'Single Version Fetch Document',
        teamId: 'team-ver-test',
        createdBy: 'user@example.com',
        document: '{"blocks": [{"type": "paragraph", "data": {"text": "Full preview content"}}]}',
        whiteboard: '[{"id":"el1","type":"ellipse"}]',
      },
    });

    const createReq = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'files:createVersion',
        args: { fileId: file.id, createdByName: 'Test User', note: 'checkpoint for preview' },
      }),
    });
    const createRes = await POST(createReq);
    const createdVer = (await createRes.json()).data;

    const singleReq = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'files:getVersions',
        args: { fileId: file.id, versionId: createdVer.id },
      }),
    });
    const singleRes = await POST(singleReq);
    expect(singleRes.status).toBe(200);
    const versionDetail = (await singleRes.json()).data;

    expect(versionDetail.document).toContain('Full preview content');
    expect(versionDetail.whiteboard).toContain('ellipse');
  });

  it('should paginate files:getVersions with take/cursor and return a nextCursor while items remain (Issue 200)', async () => {
    const file = await prisma.file.create({
      data: {
        id: 'file-ver-paginate',
        fileName: 'Paginated Checkpoints Document',
        teamId: 'team-ver-test',
        createdBy: 'user@example.com',
        document: '{"blocks":[]}',
        whiteboard: '[]',
      },
    });

    for (let i = 1; i <= 5; i++) {
      const req = new Request('http://localhost:3000/api/state-sync', {
        method: 'POST',
        body: JSON.stringify({
          path: 'files:createVersion',
          args: { fileId: file.id, createdByName: 'Test User', note: `v${i}` },
        }),
      });
      await POST(req);
    }

    const page1Req = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({ path: 'files:getVersions', args: { fileId: file.id, take: 2 } }),
    });
    const page1Res = await POST(page1Req);
    const page1 = (await page1Res.json()).data;
    expect(page1.items.length).toBe(2);
    expect(page1.nextCursor).toBeTruthy();
    // Most recent checkpoint (version 5) comes first
    expect(page1.items[0].version).toBe(5);

    const page2Req = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'files:getVersions',
        args: { fileId: file.id, take: 2, cursor: page1.nextCursor },
      }),
    });
    const page2Res = await POST(page2Req);
    const page2 = (await page2Res.json()).data;
    expect(page2.items.length).toBe(2);
    expect(page2.items[0].version).toBe(3);
  });

  it('should retain at most 50 versions per file after creating a 51st, keeping the most recent by version number (Issue 200)', async () => {
    const file = await prisma.file.create({
      data: {
        id: 'file-ver-retention',
        fileName: 'Retention Policy Document',
        teamId: 'team-ver-test',
        createdBy: 'user@example.com',
        document: '{"blocks":[]}',
        whiteboard: '[]',
      },
    });

    for (let i = 1; i <= 51; i++) {
      const req = new Request('http://localhost:3000/api/state-sync', {
        method: 'POST',
        body: JSON.stringify({
          path: 'files:createVersion',
          args: { fileId: file.id, createdByName: 'Test User', note: `checkpoint ${i}` },
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
    }

    const allVersions = await prisma.fileVersion.findMany({
      where: { fileId: file.id },
      orderBy: { version: 'asc' },
      select: { version: true },
    });

    expect(allVersions.length).toBe(50);
    // Version 1 must have been pruned; versions 2-51 (the 50 most recent) remain.
    expect(allVersions[0].version).toBe(2);
    expect(allVersions[allVersions.length - 1].version).toBe(51);
  }, 30_000);

  it('should successfully dispatch a state-sync:refetch event via triggerQueryRefetch for in-place SPA synchronization', () => {
    const firedEvents: any[] = [];
    
    const handleRefetch = (e: any) => {
      firedEvents.push(e.detail);
    };

    window.addEventListener('state-sync:refetch', handleRefetch);

    triggerQueryRefetch('files:getFileById', 'test-file-123');

    window.removeEventListener('state-sync:refetch', handleRefetch);

    expect(firedEvents.length).toBe(1);
    expect(firedEvents[0]).toEqual({
      path: 'files:getFileById',
      fileId: 'test-file-123'
    });
  });
});
