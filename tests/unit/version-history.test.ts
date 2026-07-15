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
    const versionsList = (await getRes.json()).data;
    expect(versionsList.length).toBe(1);
    expect(versionsList[0].version).toBe(1);

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
