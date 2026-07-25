import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as stateSyncPOST } from '@/app/api/state-sync/route';

// Regression: app/api/state-sync/route.ts's dispatcher only routed to
// handleFileService for `path.startsWith('files:') || path ===
// 'collabpro_update_whiteboard'` - collabpro_update_document (the MCP write
// tool for documents) was missing from that condition entirely, so every
// call to it fell through to the generic 404 despite fileService.ts having a
// complete, working handler for it. This test exercises the REAL dispatcher
// (not a mock of it) so a missing dispatch branch like this actually fails
// the test, unlike tests/unit/mcp-route.test.ts which mocks verifyApiKey and
// never reaches this code at all.

let fileRow: { id: string; teamId: string; createdBy: string; document: string };

const mockFileFindUnique = vi.fn();
const mockFileUpdateMany = vi.fn();
const mockTeamMemberFindFirst = vi.fn();
const mockApiKeyFindUnique = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    file: {
      findUnique: (...args: any[]) => mockFileFindUnique(...args),
      updateMany: (...args: any[]) => mockFileUpdateMany(...args),
      update: vi.fn(),
    },
    teamMember: {
      findFirst: (...args: any[]) => mockTeamMemberFindFirst(...args),
      findMany: vi.fn().mockResolvedValue([]),
    },
    apiKey: {
      findUnique: (...args: any[]) => mockApiKeyFindUnique(...args),
    },
    fileVersion: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/session-auth/server', () => ({
  getServerSession: () => ({
    getUser: vi.fn().mockResolvedValue(null), // force API-key auth path, matching a real MCP client
  }),
}));

vi.mock('@/lib/redis-cache', () => ({
  invalidateCachedFile: vi.fn(),
  getCachedFile: vi.fn().mockResolvedValue({ id: 'file-1', fileName: 'Test File' }),
}));

import { hashApiKey } from '@/lib/api-key-middleware';

describe('MCP write tools reach the real dispatcher (issue found in review)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fileRow = {
      id: 'file-1',
      teamId: 'team-1',
      createdBy: 'agent-user@collabpro.com',
      document: JSON.stringify({ time: 1, version: '2.8.1', blocks: [] }),
    };
    mockApiKeyFindUnique.mockResolvedValue({
      id: 'key-1',
      userEmail: 'agent-user@collabpro.com',
      hashedKey: hashApiKey('collabpro_pat_readwrite_test'),
      expiresAt: null,
      scope: 'read-write',
    });
    mockFileFindUnique.mockImplementation(async (args: any) => {
      if (args?.include?.team) {
        return { ...fileRow, team: { createdBy: fileRow.createdBy } };
      }
      return { id: fileRow.id, document: fileRow.document };
    });
    mockFileUpdateMany.mockImplementation(async ({ where, data }: any) => {
      if (where.document !== fileRow.document) return { count: 0 };
      fileRow = { ...fileRow, document: data.document };
      return { count: 1 };
    });
  });

  it('collabpro_update_document actually reaches fileService and persists, not a 404', async () => {
    const req = new Request('http://localhost/api/state-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer collabpro_pat_readwrite_test',
      },
      body: JSON.stringify({
        path: 'collabpro_update_document',
        args: { fileId: 'file-1', document: { time: 2, version: '2.8.1', blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'hi' } }] } },
      }),
    });

    const res = await stateSyncPOST(req);
    const body = await res.json();

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
    expect(body.data.updated).toBe(true);
  });

  it('collabpro_update_whiteboard (the sibling tool that was NOT missing) still works, as a control', async () => {
    fileRow = { ...fileRow, document: '' } as any;
    (fileRow as any).whiteboard = '[]';
    mockFileFindUnique.mockImplementation(async (args: any) => {
      if (args?.include?.team) {
        return { ...fileRow, team: { createdBy: fileRow.createdBy } };
      }
      return { id: fileRow.id, whiteboard: (fileRow as any).whiteboard };
    });
    mockFileUpdateMany.mockImplementation(async ({ where, data }: any) => {
      if (where.whiteboard !== (fileRow as any).whiteboard) return { count: 0 };
      (fileRow as any).whiteboard = data.whiteboard;
      return { count: 1 };
    });

    const req = new Request('http://localhost/api/state-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer collabpro_pat_readwrite_test',
      },
      body: JSON.stringify({
        path: 'collabpro_update_whiteboard',
        args: { fileId: 'file-1', whiteboard: [{ id: 'el-1', type: 'rectangle', x: 0, y: 0, width: 100, height: 100 }] },
      }),
    });

    const res = await stateSyncPOST(req);
    expect(res.status).toBe(200);
  });

  it('a read-only-scoped API key CAN call a read tool (files:getFileById) - previously blocked on every call', async () => {
    mockApiKeyFindUnique.mockResolvedValue({
      id: 'key-2',
      userEmail: 'agent-user@collabpro.com',
      hashedKey: hashApiKey('collabpro_pat_readonly_test'),
      expiresAt: null,
      scope: 'read-only',
    });

    const req = new Request('http://localhost/api/state-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer collabpro_pat_readonly_test',
      },
      body: JSON.stringify({
        path: 'files:getFileById',
        args: { _id: 'file-1' },
      }),
    });

    const res = await stateSyncPOST(req);
    // Regression: previously 403'd unconditionally because every call here
    // is an HTTP POST and the old scope check treated any POST as a write.
    expect(res.status).not.toBe(403);
  });

  it('a read-only-scoped API key is still correctly blocked from collabpro_update_document', async () => {
    mockApiKeyFindUnique.mockResolvedValue({
      id: 'key-3',
      userEmail: 'agent-user@collabpro.com',
      hashedKey: hashApiKey('collabpro_pat_readonly_write_attempt'),
      expiresAt: null,
      scope: 'read-only',
    });

    const req = new Request('http://localhost/api/state-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer collabpro_pat_readonly_write_attempt',
      },
      body: JSON.stringify({
        path: 'collabpro_update_document',
        args: { fileId: 'file-1', document: { blocks: [] } },
      }),
    });

    const res = await stateSyncPOST(req);
    expect(res.status).toBe(403);
  });
});
