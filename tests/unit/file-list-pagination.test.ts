import 'dotenv/config';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/state-sync/route';
import { prisma } from '@/lib/db';

// Mock server-auth so requests authenticate as a fixed user, and mock
// redis-cache the same way tests/unit/version-history.test.ts does (this
// route path calls into fileService.ts, which imports from redis-cache).
vi.mock('@/lib/session-auth/server', () => {
  return {
    getServerSession: vi.fn().mockReturnValue({
      getUser: vi.fn().mockResolvedValue({ email: 'owner@example.com', given_name: 'Owner' }),
    }),
  };
});

vi.mock('@/lib/redis-cache', () => {
  return {
    getCachedFile: vi.fn(),
    invalidateCachedFile: vi.fn().mockResolvedValue(undefined),
  };
});

describe('files:getFiles poll payload trimming and pagination (Issue 190)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.fileVersion.deleteMany({});
    await prisma.filePresence.deleteMany({});
    await prisma.sharedLink.deleteMany({});
    await prisma.file.deleteMany({});
    await prisma.teamMember.deleteMany({});
    await prisma.team.deleteMany({});

    await prisma.team.create({
      data: {
        id: 'team-filelist-test',
        teamName: 'FileList Pagination Test Team',
        createdBy: 'owner@example.com',
      },
    });
  });

  it('does not include document or whiteboard blobs in files:getFiles responses', async () => {
    await prisma.file.create({
      data: {
        id: 'file-list-noblobs',
        fileName: 'No Blobs File',
        teamId: 'team-filelist-test',
        createdBy: 'owner@example.com',
        document: '{"blocks": [{"type": "paragraph", "data": {"text": "Should not leak on every 4s poll"}}]}',
        whiteboard: '[{"id":"el1","type":"rectangle"}]',
      },
    });

    const req = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'files:getFiles',
        args: { teamId: 'team-filelist-test' },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const page = (await res.json()).data;

    expect(page.items.length).toBe(1);
    for (const item of page.items) {
      expect(item).not.toHaveProperty('document');
      expect(item).not.toHaveProperty('whiteboard');
      // Fields the dashboard UI actually renders must still be present
      expect(item).toHaveProperty('fileName');
      expect(item).toHaveProperty('archive');
      expect(item).toHaveProperty('createdAt');
      expect(item).toHaveProperty('creatorName');
      expect(item).toHaveProperty('creatorImage');
      expect(item).toHaveProperty('teamName');
    }
  });

  it('paginates with take/cursor, returning exactly `take` items and a nextCursor when 20 files exist on a team and take=10', async () => {
    const fileData = Array.from({ length: 20 }, (_, i) => ({
      id: `file-list-page-${i}`,
      fileName: `File ${i}`,
      teamId: 'team-filelist-test',
      createdBy: 'owner@example.com',
      document: '',
      whiteboard: '',
    }));
    for (const data of fileData) {
      await prisma.file.create({ data });
    }

    const req = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'files:getFiles',
        args: { teamId: 'team-filelist-test', take: 10 },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const page = (await res.json()).data;

    expect(page.items.length).toBe(10);
    expect(page.nextCursor).toBeTruthy();

    const req2 = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'files:getFiles',
        args: { teamId: 'team-filelist-test', take: 10, cursor: page.nextCursor },
      }),
    });
    const res2 = await POST(req2);
    const page2 = (await res2.json()).data;
    expect(page2.items.length).toBe(10);
    expect(page2.nextCursor).toBeFalsy();

    // No overlap between the two pages
    const idsPage1 = new Set(page.items.map((f: any) => f.id));
    const idsPage2 = new Set(page2.items.map((f: any) => f.id));
    for (const id of idsPage2) {
      expect(idsPage1.has(id)).toBe(false);
    }
  });

  it('defaults to a take of 50 when no `take` argument is supplied', async () => {
    const fileData = Array.from({ length: 5 }, (_, i) => ({
      id: `file-list-default-${i}`,
      fileName: `Default File ${i}`,
      teamId: 'team-filelist-test',
      createdBy: 'owner@example.com',
      document: '',
      whiteboard: '',
    }));
    for (const data of fileData) {
      await prisma.file.create({ data });
    }

    const req = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'files:getFiles',
        args: { teamId: 'team-filelist-test' },
      }),
    });
    const res = await POST(req);
    const page = (await res.json()).data;
    expect(page.items.length).toBe(5);
    expect(page.nextCursor).toBeFalsy();
  });

  it('clamps `take` to a documented maximum (100) instead of allowing an effectively unbounded page', async () => {
    const fileData = Array.from({ length: 120 }, (_, i) => ({
      id: `file-list-clamp-${i}`,
      fileName: `Clamp File ${i}`,
      teamId: 'team-filelist-test',
      createdBy: 'owner@example.com',
      document: '',
      whiteboard: '',
    }));
    for (const data of fileData) {
      await prisma.file.create({ data });
    }

    const req = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'files:getFiles',
        args: { teamId: 'team-filelist-test', take: 10_000 },
      }),
    });
    const res = await POST(req);
    const page = (await res.json()).data;

    // A caller asking for 10,000 must not get all 120 in one call - the
    // pagination clamp is meant to bound worst-case page size regardless of
    // what a client requests.
    expect(page.items.length).toBe(100);
    expect(page.nextCursor).toBeTruthy();
  });

  it('a team with 51+ files still shows all of them via the dashboard\'s realistic take value, not just the first 50 (Issue: dashboard pagination regression)', async () => {
    const fileData = Array.from({ length: 51 }, (_, i) => ({
      id: `file-list-dashboard-${i}`,
      fileName: `Dashboard File ${i}`,
      teamId: 'team-filelist-test',
      createdBy: 'owner@example.com',
      document: '',
      whiteboard: '',
    }));
    for (const data of fileData) {
      await prisma.file.create({ data });
    }

    // This mirrors the `take` value the dashboard/sidebar components now
    // pass explicitly (see FileList.tsx / SideNav.tsx / SideNavTopSection.tsx)
    // — since files:getFiles is paginated with a default of 50, a UI call
    // site that doesn't pass `take` at all would silently lose every file
    // past the 50th with no error and no indication anything is missing.
    const req = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'files:getFiles',
        args: { teamId: 'team-filelist-test', take: 100 },
      }),
    });
    const res = await POST(req);
    const page = (await res.json()).data;

    expect(page.items.length).toBe(51);
  });
});
