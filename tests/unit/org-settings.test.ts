import 'dotenv/config';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/state-sync/route';
import { prisma } from '@/lib/db';

// Mock server-auth and redis-cache
vi.mock('@/lib/session-auth/server', () => {
  return {
    getServerSession: vi.fn().mockReturnValue({
      getUser: vi.fn().mockResolvedValue({ email: 'owner@enterprise.com', given_name: 'Owner User' }),
    }),
  };
});

vi.mock('@/lib/redis-cache', () => {
  return {
    getCachedFile: vi.fn(),
    invalidateCachedFile: vi.fn().mockResolvedValue(undefined),
  };
});

describe('Organization Admin Settings Control Center Suite (Issue 9)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Clean database tables before each test execution
    await prisma.orgSetting.deleteMany({});
    await prisma.invitation.deleteMany({});
    await prisma.teamMember.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.notification.deleteMany({});
    await prisma.user.deleteMany({});

    // Seed required users to satisfy foreign key constraints for invitations and notifications
    await prisma.user.create({
      data: {
        email: "owner@enterprise.com",
        name: "Owner User",
      },
    });
    await prisma.user.create({
      data: {
        email: "colleague@partner.com",
        name: "Partner Colleague",
      },
    });
    await prisma.user.create({
      data: {
        email: "colleague@enterprise.com",
        name: "Enterprise Colleague",
      },
    });
  });

  it('should auto-generate default settings, retrieve active seats, and update organization policy rules', async () => {
    // 1. Create a dummy team
    const team = await prisma.team.create({
      data: {
        id: 'team-org-test',
        teamName: 'Enterprise Org',
        createdBy: 'owner@enterprise.com',
      },
    });

    // 2. Fetch configurations - should dynamically create default record
    const getReq = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'orgSettings:getSettings',
        args: { teamId: team.id },
      }),
    });
    const getRes = await POST(getReq);
    expect(getRes.status).toBe(200);
    const settings = (await getRes.json()).data;
    expect(settings.teamId).toBe(team.id);
    expect(settings.seatLimit).toBe(50);
    expect(settings.allowedDomains).toBe('');
    expect(settings.ssoEnabled).toBe(false);

    // 3. Update configurations via API
    const updateReq = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'orgSettings:updateSettings',
        args: {
          teamId: team.id,
          allowedDomains: 'enterprise.com,acme.com',
          ssoEnabled: true,
          ssoProvider: 'saml',
          ssoMetadataUrl: 'https://idp.enterprise.com/saml/metadata',
          seatLimit: 10,
        },
      }),
    });
    const updateRes = await POST(updateReq);
    expect(updateRes.status).toBe(200);

    const updatedSettings = await prisma.orgSetting.findUnique({
      where: { teamId: team.id },
    });
    expect(updatedSettings?.allowedDomains).toBe('enterprise.com,acme.com');
    expect(updatedSettings?.ssoEnabled).toBe(true);
    expect(updatedSettings?.ssoProvider).toBe('saml');
    expect(updatedSettings?.ssoMetadataUrl).toBe('https://idp.enterprise.com/saml/metadata');
    expect(updatedSettings?.seatLimit).toBe(10);

    // 4. Retrieve seat counts (1 active seat - the owner)
    const seatReq = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'orgSettings:getSeatCount',
        args: { teamId: team.id },
      }),
    });
    const seatRes = await POST(seatReq);
    expect(seatRes.status).toBe(200);
    const seatCount = (await seatRes.json()).data;
    expect(seatCount.activeSeats).toBe(1);
    expect(seatCount.pendingInvitations).toBe(0);
    expect(seatCount.seatLimit).toBe(10);
  });

  it('should enforce allowed domain signup restriction rules during member invitation', async () => {
    // 1. Create team & organization configurations with allowed domains restriction
    const team = await prisma.team.create({
      data: {
        id: 'team-domain-test',
        teamName: 'Secure Inc',
        createdBy: 'owner@enterprise.com',
      },
    });

    await prisma.orgSetting.create({
      data: {
        teamId: team.id,
        allowedDomains: 'enterprise.com, partner.com',
        seatLimit: 5,
      },
    });

    // 2. Invite a user with an authorized domain (partner.com) - should SUCCEED
    const goodInviteReq = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'teams:inviteMember',
        args: {
          teamId: team.id,
          userEmail: 'colleague@partner.com',
        },
      }),
    });
    const goodInviteRes = await POST(goodInviteReq);
    expect(goodInviteRes.status).toBe(200);

    // 3. Invite a user with a restricted domain (gmail.com) - should FAIL
    const badInviteReq = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'teams:inviteMember',
        args: {
          teamId: team.id,
          userEmail: 'hacker@gmail.com',
        },
      }),
    });
    const badInviteRes = await POST(badInviteReq);
    expect(badInviteRes.status).toBe(500);
    const badInviteBody = await badInviteRes.json();
    expect(badInviteBody.error).toContain('is not authorized');
  });

  it('should enforce active seat limits, blocking further member invitations when capacity is reached', async () => {
    // 1. Create team & organization configuration restricting capacity to exactly 1 seat
    const team = await prisma.team.create({
      data: {
        id: 'team-capacity-test',
        teamName: 'Micro Org',
        createdBy: 'owner@enterprise.com',
      },
    });

    await prisma.orgSetting.create({
      data: {
        teamId: team.id,
        seatLimit: 1, // Only the owner takes this 1 seat!
      },
    });

    // 2. Invite a member - should fail instantly because seat capacity (1) is already filled by the owner (1)
    const inviteReq = new Request('http://localhost:3000/api/state-sync', {
      method: 'POST',
      body: JSON.stringify({
        path: 'teams:inviteMember',
        args: {
          teamId: team.id,
          userEmail: 'colleague@enterprise.com',
        },
      }),
    });
    const inviteRes = await POST(inviteReq);
    expect(inviteRes.status).toBe(500);
    const inviteBody = await inviteRes.json();
    expect(inviteBody.error).toContain('Seat limit reached');
  });
});
