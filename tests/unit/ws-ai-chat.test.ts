import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeQuery, executeMutation } from '../../ws-server/mutations';

/**
 * Regression coverage for a severe bug found live: the AI Co-Pilot sidebar
 * subscribes to ai:getSettings/chat:getMessages over the WebSocket gateway
 * (ws-server), same as every other query in the app, once a WS connection
 * is live. But ws-server's executeQuery only ever knew about
 * files:getFileById - any other path silently returned null (a console.warn,
 * not an error), which useQuery's WS-subscribe path has no fallback for.
 * Net effect: the moment a real WS connection was active (the normal,
 * intended state), the Co-Pilot's "no AI configured" empty state became
 * permanently stuck regardless of actual DB state, and chat history never
 * loaded on reload - both silently, with no error surfaced anywhere.
 */

function basePrisma(overrides: Partial<any> = {}) {
  return {
    file: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    team: { findUnique: vi.fn() },
    teamAiSettings: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    chatMessage: { findMany: vi.fn(), deleteMany: vi.fn() },
    ...overrides,
  };
}

describe('ws-server/mutations - ai:*/chat:* query support', () => {
  it('ai:getSettings returns the row without the encrypted key, matching the HTTP path', async () => {
    const prisma = basePrisma({
      teamAiSettings: {
        findUnique: vi.fn().mockResolvedValue({
          teamId: 'team-1', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini',
          maskedKey: 'sk-••••1234', updatedAt: new Date('2026-01-01'), encryptedKey: 'iv:tag:ct',
        }),
      },
    });

    const result = await executeQuery(prisma as any, 'ai:getSettings', { teamId: 'team-1' });
    expect(result).toEqual({
      teamId: 'team-1', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini',
      maskedKey: 'sk-••••1234', updatedAt: new Date('2026-01-01'),
    });
    expect(result.encryptedKey).toBeUndefined();
  });

  it('ai:getSettings returns null (not an error) when unconfigured - the actual reported symptom', async () => {
    const prisma = basePrisma({ teamAiSettings: { findUnique: vi.fn().mockResolvedValue(null) } });
    const result = await executeQuery(prisma as any, 'ai:getSettings', { teamId: 'team-1' });
    expect(result).toBeNull();
  });

  it('chat:getMessages scopes to the passed userEmail (the caller), never anything from args', async () => {
    const findMany = vi.fn().mockResolvedValue([{ role: 'user', content: 'hi' }]);
    const prisma = basePrisma({ chatMessage: { findMany, deleteMany: vi.fn() } });

    await executeQuery(prisma as any, 'chat:getMessages', { fileId: 'file-1' }, 'dev@collabpro.com');

    expect(findMany).toHaveBeenCalledWith({
      where: { fileId: 'file-1', userEmail: 'dev@collabpro.com' },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('unrecognized paths still fall through to null with a warning (unchanged default behavior)', async () => {
    const prisma = basePrisma();
    const result = await executeQuery(prisma as any, 'teams:getTeamMembers', {});
    expect(result).toBeNull();
  });
});

describe('ws-server/mutations - ai:*/chat:* mutation support', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long';
  });

  it('ai:saveSettings requires the caller to be the team owner', async () => {
    const prisma = basePrisma({ team: { findUnique: vi.fn().mockResolvedValue({ createdBy: 'owner@collabpro.com' }) } });
    await expect(
      executeMutation(prisma as any, vi.fn(), 'ai:saveSettings', { teamId: 'team-1', baseUrl: 'https://x', model: 'm', apiKey: 'sk-x' }, 'not-owner@collabpro.com')
    ).rejects.toThrow(/only the team owner/);
  });

  it('ai:saveSettings succeeds for the owner and never returns the encrypted key', async () => {
    const upsert = vi.fn().mockResolvedValue({ teamId: 'team-1', baseUrl: 'https://x', model: 'm', maskedKey: 'sk-••••1234' });
    const prisma = basePrisma({
      team: { findUnique: vi.fn().mockResolvedValue({ createdBy: 'owner@collabpro.com' }) },
      teamAiSettings: { findUnique: vi.fn().mockResolvedValue(null), upsert, deleteMany: vi.fn() },
    });

    const result = await executeMutation(prisma as any, vi.fn(), 'ai:saveSettings', { teamId: 'team-1', baseUrl: 'https://x', model: 'm', apiKey: 'sk-real-key' }, 'owner@collabpro.com');

    expect(result).toEqual({ teamId: 'team-1', baseUrl: 'https://x', model: 'm', maskedKey: 'sk-••••1234' });
    expect(upsert.mock.calls[0][0].create.encryptedKey).not.toContain('sk-real-key');
  });

  it('ai:deleteSettings requires the caller to be the team owner', async () => {
    const prisma = basePrisma({ team: { findUnique: vi.fn().mockResolvedValue({ createdBy: 'owner@collabpro.com' }) } });
    await expect(
      executeMutation(prisma as any, vi.fn(), 'ai:deleteSettings', { teamId: 'team-1' }, 'not-owner@collabpro.com')
    ).rejects.toThrow(/only the team owner/);
  });

  it('chat:clearHistory scopes the delete to the passed userEmail', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    const prisma = basePrisma({ chatMessage: { findMany: vi.fn(), deleteMany } });

    const result = await executeMutation(prisma as any, vi.fn(), 'chat:clearHistory', { fileId: 'file-1' }, 'dev@collabpro.com');

    expect(deleteMany).toHaveBeenCalledWith({ where: { fileId: 'file-1', userEmail: 'dev@collabpro.com' } });
    expect(result).toEqual({ success: true });
  });

  it('still throws for a genuinely unsupported mutation path (unchanged default behavior)', async () => {
    const prisma = basePrisma();
    await expect(executeMutation(prisma as any, vi.fn(), 'teams:inviteMember', {}, 'dev@collabpro.com')).rejects.toThrow(/Unsupported/);
  });
});
