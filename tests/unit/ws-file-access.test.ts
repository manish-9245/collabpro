import { describe, it, expect, vi } from 'vitest';
import { hasFileAccess, resolveTokenUser, checkTeamAccess } from '../../ws-server/file-access';

// Issue #234: an unverified `?token=` value was previously JSON.parse'd and
// trusted as the authenticated user whenever signature verification failed
// (bad signature, malformed, expired) - letting anyone connect as any user
// by claiming `?token=<url-encoded JSON>`.
describe('resolveTokenUser (issue #234 — unsigned-token auth bypass)', () => {
  it('returns the verified user when verification succeeds', () => {
    const verifyTokenFn = vi.fn().mockReturnValue({ id: 'u1', email: 'user@test.com' });
    const result = resolveTokenUser('some-jwt', verifyTokenFn);
    expect(result).toEqual({ id: 'u1', email: 'user@test.com' });
  });

  it('does NOT fall back to parsing the raw value as JSON when verification fails', () => {
    const forgedIdentity = encodeURIComponent(JSON.stringify({ id: 'attacker', email: 'victim@test.com' }));
    const verifyTokenFn = vi.fn().mockReturnValue(null);
    const result = resolveTokenUser(forgedIdentity, verifyTokenFn);
    expect(result).toBeNull();
  });

  it('returns null when the token value is malformed', () => {
    const verifyTokenFn = vi.fn().mockReturnValue(null);
    expect(resolveTokenUser('%', verifyTokenFn)).toBeNull();
  });
});

describe('checkTeamAccess (issue #234 — files:createFile had no authorization check)', () => {
  it('grants access to the team creator', async () => {
    const prismaClient = {
      team: { findUnique: vi.fn().mockResolvedValue({ createdBy: 'owner@test.com' }) },
      teamMember: { findFirst: vi.fn() },
    };
    expect(await checkTeamAccess(prismaClient as any, 'team-1', 'owner@test.com')).toBe(true);
    expect(prismaClient.teamMember.findFirst).not.toHaveBeenCalled();
  });

  it('grants access to a team member and denies a non-member', async () => {
    const findUnique = vi.fn().mockResolvedValue({ createdBy: 'owner@test.com' });
    const member = {
      team: { findUnique },
      teamMember: { findFirst: vi.fn().mockResolvedValue({ userEmail: 'member@test.com' }) },
    };
    expect(await checkTeamAccess(member as any, 'team-1', 'member@test.com')).toBe(true);

    const stranger = {
      team: { findUnique },
      teamMember: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    expect(await checkTeamAccess(stranger as any, 'team-1', 'stranger@test.com')).toBe(false);
  });

  it('denies access when the team does not exist, without throwing', async () => {
    const prismaClient = {
      team: { findUnique: vi.fn().mockResolvedValue(null) },
      teamMember: { findFirst: vi.fn() },
    };
    expect(await checkTeamAccess(prismaClient as any, 'missing-team', 'anyone@test.com')).toBe(false);
  });

  it('denies when teamId or email is missing', async () => {
    const prismaClient = {
      team: { findUnique: vi.fn() },
      teamMember: { findFirst: vi.fn() },
    };
    expect(await checkTeamAccess(prismaClient as any, '', 'user@test.com')).toBe(false);
    expect(await checkTeamAccess(prismaClient as any, 'team-1', '')).toBe(false);
    expect(prismaClient.team.findUnique).not.toHaveBeenCalled();
  });
});

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
