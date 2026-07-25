import { describe, it, expect, vi } from 'vitest';
import { hasFileAccess } from '../../ws-server/file-access';

// Issue #198: hasFileAccess() was called on every cursor message and did
// prisma.file.findUnique({ where: { id: fileId } }) with no `select`,
// pulling the full document/whiteboard blobs just to read
// createdBy/teamId. This asserts the query is scoped to only the fields it
// actually needs.
describe('hasFileAccess (issue #198 — narrow select, no document/whiteboard payload)', () => {
  it('selects only createdBy and teamId, never document or whiteboard', async () => {
    const findUnique = vi.fn().mockResolvedValue({ createdBy: 'owner@test.com', teamId: 'team-1' });
    const findFirst = vi.fn();
    const prismaClient = { file: { findUnique }, teamMember: { findFirst } };

    await hasFileAccess(prismaClient as any, 'file-1', 'owner@test.com');

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'file-1' },
      select: { createdBy: true, teamId: true },
    });
    const callArgs = findUnique.mock.calls[0][0];
    expect(callArgs.select).not.toHaveProperty('document');
    expect(callArgs.select).not.toHaveProperty('whiteboard');
  });

  it('grants access to the file creator without a team lookup', async () => {
    const findUnique = vi.fn().mockResolvedValue({ createdBy: 'owner@test.com', teamId: 'team-1' });
    const findFirst = vi.fn();
    const prismaClient = { file: { findUnique }, teamMember: { findFirst } };

    const allowed = await hasFileAccess(prismaClient as any, 'file-1', 'owner@test.com');

    expect(allowed).toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('grants access to a team member and denies a non-member', async () => {
    const findUnique = vi.fn().mockResolvedValue({ createdBy: 'owner@test.com', teamId: 'team-1' });
    const prismaClient = {
      file: { findUnique },
      teamMember: { findFirst: vi.fn().mockResolvedValue({ role: 'editor' }) },
    };

    expect(await hasFileAccess(prismaClient as any, 'file-1', 'member@test.com')).toBe(true);

    const prismaClientDenied = {
      file: { findUnique },
      teamMember: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    expect(await hasFileAccess(prismaClientDenied as any, 'file-1', 'stranger@test.com')).toBe(false);
  });

  it('returns false when the file does not exist, without throwing', async () => {
    const prismaClient = {
      file: { findUnique: vi.fn().mockResolvedValue(null) },
      teamMember: { findFirst: vi.fn() },
    };
    expect(await hasFileAccess(prismaClient as any, 'missing', 'user@test.com')).toBe(false);
  });
});
