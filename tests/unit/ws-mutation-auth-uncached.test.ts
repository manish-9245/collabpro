import { describe, it, expect, vi } from 'vitest';
import { checkMutationAuth } from '../../ws-server/file-access';

// Group 5 #1 (review round 2, P1): the 45s access-cache was shared between
// cursor-traffic authorization (fine to cache, low stakes) and *mutation*
// authorization (should not tolerate the TTL window — a removed team member
// could keep writing until the cache entry expired). checkMutationAuth must
// always check access fresh against the database, never consult the cache.
describe('checkMutationAuth always re-checks access fresh, never cached (issue found in review, Group 5 #1)', () => {
  it('denies a mutation the moment a team member is removed, without waiting for any cache TTL', async () => {
    // First call: the requester IS a team member.
    const findUnique = vi.fn().mockResolvedValue({ createdBy: 'owner@test.com', teamId: 'team-1' });
    const findFirst = vi.fn()
      .mockResolvedValueOnce({ role: 'editor' })  // first call: still a member
      .mockResolvedValueOnce(null);                // second call: removed
    const prismaClient = { file: { findUnique }, teamMember: { findFirst } };

    const first = await checkMutationAuth(prismaClient as any, 'file-1', 'member@test.com');
    expect(first.allowed).toBe(true);

    // Immediately after (no cache TTL elapsed), membership is now gone.
    const second = await checkMutationAuth(prismaClient as any, 'file-1', 'member@test.com');
    expect(second.allowed).toBe(false);

    // Fresh DB lookups both times — proves no caching occurred.
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('denies a viewer from mutating', async () => {
    const findUnique = vi.fn().mockResolvedValue({ createdBy: 'owner@test.com', teamId: 'team-1' });
    const findFirst = vi.fn().mockResolvedValue({ role: 'viewer' });
    const prismaClient = { file: { findUnique }, teamMember: { findFirst } };

    const result = await checkMutationAuth(prismaClient as any, 'file-1', 'viewer@test.com');
    expect(result.allowed).toBe(false);
    expect(result.error).toMatch(/viewer/i);
  });

  it('allows the file creator', async () => {
    const findUnique = vi.fn().mockResolvedValue({ createdBy: 'owner@test.com', teamId: 'team-1' });
    const findFirst = vi.fn();
    const prismaClient = { file: { findUnique }, teamMember: { findFirst } };

    const result = await checkMutationAuth(prismaClient as any, 'file-1', 'owner@test.com');
    expect(result.allowed).toBe(true);
  });

  it('denies access to a file that does not exist', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const findFirst = vi.fn();
    const prismaClient = { file: { findUnique }, teamMember: { findFirst } };

    const result = await checkMutationAuth(prismaClient as any, 'missing', 'user@test.com');
    expect(result.allowed).toBe(false);
  });
});
