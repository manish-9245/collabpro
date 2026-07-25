import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as stateSyncPOST } from '@/app/api/state-sync/route';

// P1 (review round 2, Group 1): a brand-new file's default document/whiteboard
// is the raw empty string "" (see files:createFile — `document: document ??
// ''`, `whiteboard: whiteboard ?? ''`). The CAS predicate must compare
// against that exact raw value; comparing against a normalized/synthesized
// default instead means the very first save on any new file conflicts
// forever (updateMany always returns count: 0, CAS retries exhaust, and the
// request fails with "concurrent updates" even though nothing else ever
// wrote to the row).

let fileRow: { id: string; document: string; whiteboard: string };

const mockFindUnique = vi.fn();
const mockUpdateMany = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    file: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
      updateMany: (...args: any[]) => mockUpdateMany(...args),
      update: vi.fn(),
    },
    apiKey: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/session-auth/server', () => ({
  getServerSession: () => ({
    getUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'user@test.com', name: 'Test User' }),
  }),
}));

vi.mock('@/lib/redis-cache', () => ({
  invalidateCachedFile: vi.fn(),
  getCachedFile: vi.fn(),
}));

describe('first save on a brand-new file succeeds (issue found in review, Group 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Exactly what files:createFile actually persists for a new file.
    fileRow = { id: 'file-brand-new', document: '', whiteboard: '' };

    mockFindUnique.mockImplementation(async () => ({ ...fileRow, createdBy: 'user@test.com' }));
    mockUpdateMany.mockImplementation(async ({ where, data }: any) => {
      if (where.document !== undefined && where.document !== fileRow.document) return { count: 0 };
      if (where.whiteboard !== undefined && where.whiteboard !== fileRow.whiteboard) return { count: 0 };
      fileRow = { ...fileRow, ...data };
      return { count: 1 };
    });
  });

  it('files:updateDocument succeeds on the first attempt for a new file with document ""', async () => {
    const req = new Request('http://localhost/api/state-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: 'files:updateDocument',
        args: {
          _id: 'file-brand-new',
          document: JSON.stringify({ time: Date.now(), version: '2.8.1', blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'hello' } }] }),
        },
      }),
    });

    const res = await stateSyncPOST(req);
    expect(res.status).toBe(200);
    // Must succeed on the very first CAS attempt — not "conflict, retry,
    // eventually give up".
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fileRow.document).blocks).toHaveLength(1);
  });

  it('files:updateWhiteboard succeeds on the first attempt for a new file with whiteboard ""', async () => {
    const req = new Request('http://localhost/api/state-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: 'files:updateWhiteboard',
        args: {
          _id: 'file-brand-new',
          whiteboard: JSON.stringify({ elements: [{ id: 'el-1', type: 'rectangle', x: 0 }], files: {} }),
        },
      }),
    });

    const res = await stateSyncPOST(req);
    expect(res.status).toBe(200);
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fileRow.whiteboard).elements).toHaveLength(1);
  });
});
