import { describe, it, expect, vi } from 'vitest';
import { checkTeamAccess } from '../../lib/team-access';

// Issue #234: files:createFile had no authorization check at all (no
// existing row to key checkMutationAuth off of). This gate is shared by the
// WS gateway (ws-server/server.ts) and the HTTP path
// (app/api/state-sync/route.ts) so the two authorization paths can't drift.
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

  it('denies access and does not throw when the lookup fails', async () => {
    const prismaClient = {
      team: { findUnique: vi.fn().mockRejectedValue(new Error('db error')) },
      teamMember: { findFirst: vi.fn() },
    };
    expect(await checkTeamAccess(prismaClient as any, 'team-1', 'user@test.com')).toBe(false);
  });
});
