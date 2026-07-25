import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as stateSyncPOST } from '@/app/api/state-sync/route';

// Issue #197 (partial): files:updateDocument / files:updateWhiteboard used to
// seed a module-level debounce map from a `findUnique` read, then merge
// further writes into that same in-memory entry before a single delayed
// flush. That has a race: two concurrent requests can both read the current
// row BEFORE either seeds the debounce map, so both merge from the same
// stale base and the later flush silently discards the earlier write. This
// test simulates that race at the database layer via prisma.file.updateMany:
// the first compare-and-swap attempt loses (count: 0, someone else wrote
// first) and must retry against the fresh row rather than dropping the
// write.

let fileRow: { id: string; document: string };

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

function makeDocument(blockIds: string[]) {
  return JSON.stringify({
    time: Date.now(),
    version: '2.8.1',
    blocks: blockIds.map((id) => ({ id, type: 'paragraph', data: { text: id } })),
  });
}

function request(document: string) {
  return new Request('http://localhost/api/state-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: 'files:updateDocument',
      args: { _id: 'file-cas-1', document },
    }),
  });
}

describe('files:updateDocument compare-and-swap under concurrent writers (issue #197 partial)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fileRow = { id: 'file-cas-1', document: makeDocument(['base']) };

    mockFindUnique.mockImplementation(async () => ({ ...fileRow, createdBy: 'user@test.com' }));

    // First updateMany call ever made loses the race (count: 0); every
    // subsequent call succeeds and actually mutates the backing row, exactly
    // like a real `WHERE document = <expected>` CAS would once the retry
    // reads the fresh value.
    let callCount = 0;
    mockUpdateMany.mockImplementation(async ({ where, data }: any) => {
      callCount += 1;
      if (callCount === 1) {
        return { count: 0 };
      }
      if (where.document !== fileRow.document) {
        return { count: 0 };
      }
      fileRow = { ...fileRow, document: data.document };
      return { count: 1 };
    });
  });

  it('retries on CAS conflict instead of silently dropping the write', async () => {
    const res = await stateSyncPOST(request(makeDocument(['base', 'concurrent-writer'])));
    expect(res.status).toBe(200);

    // Must have retried at least once (lost the first CAS race, then won).
    expect(mockUpdateMany.mock.calls.length).toBeGreaterThanOrEqual(2);

    const finalDoc = JSON.parse(fileRow.document);
    expect(finalDoc.blocks.map((b: any) => b.id)).toContain('concurrent-writer');
  });

  it('both of two concurrent writers eventually persist their block, none silently dropped', async () => {
    const [resA, resB] = await Promise.all([
      stateSyncPOST(request(makeDocument(['base', 'writer-a']))),
      stateSyncPOST(request(makeDocument(['base', 'writer-b']))),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const finalDoc = JSON.parse(fileRow.document);
    const ids = finalDoc.blocks.map((b: any) => b.id);
    // Neither writer's block should have been silently discarded by a stale
    // debounce seed — a correct CAS+merge retry loop converges both in.
    expect(ids).toContain('writer-a');
    expect(ids).toContain('writer-b');
  });
});
