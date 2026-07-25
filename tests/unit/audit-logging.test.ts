import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { signToken } from '@/lib/session-auth/jwt';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { GET as logoutGET } from '@/app/api/auth/logout/route';
import { POST as apiKeysPOST, DELETE as apiKeysDELETE } from '@/app/api/api-keys/route';
import { POST as sharePOST, DELETE as shareDELETE } from '@/app/api/share/route';

// --- Mock next/headers cookies() ---
let cookiesMock: Record<string, string> = {};

const mockGet = vi.fn((name: string) => {
  return cookiesMock[name] ? { name, value: cookiesMock[name] } : undefined;
});
const mockSet = vi.fn((name: string, value: string) => {
  cookiesMock[name] = value;
});
const mockDelete = vi.fn((name: string) => {
  delete cookiesMock[name];
});

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: mockGet,
    set: mockSet,
    delete: mockDelete,
  }),
}));

// --- Mock getServerSession() for routes that use it directly (api-keys, share) ---
let currentSessionUser: { email: string } | null = null;

vi.mock('@/lib/session-auth/server', () => ({
  getServerSession: () => ({
    getUser: async () => currentSessionUser,
  }),
}));

// --- Mock prisma ---
const mockUserFindUnique = vi.fn();
const mockUserCreate = vi.fn();
const mockAuditLogCreate = vi.fn();
const mockApiKeyCreate = vi.fn();
const mockApiKeyFindUnique = vi.fn();
const mockApiKeyDelete = vi.fn();
const mockSharedLinkCreate = vi.fn();
const mockSharedLinkUpdate = vi.fn();
const mockSharedLinkDelete = vi.fn();
const mockSharedLinkDeleteMany = vi.fn();
const mockSharedLinkFindUnique = vi.fn();
const mockFileFindUnique = vi.fn();
const mockCheckFileAccess = vi.fn();

vi.mock('@/lib/file-access', () => ({
  checkFileAccess: (...args: any[]) => mockCheckFileAccess(...args),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => mockUserFindUnique(...args),
      create: (...args: any[]) => mockUserCreate(...args),
    },
    auditLog: {
      create: (...args: any[]) => mockAuditLogCreate(...args),
    },
    apiKey: {
      create: (...args: any[]) => mockApiKeyCreate(...args),
      findUnique: (...args: any[]) => mockApiKeyFindUnique(...args),
      delete: (...args: any[]) => mockApiKeyDelete(...args),
    },
    sharedLink: {
      create: (...args: any[]) => mockSharedLinkCreate(...args),
      update: (...args: any[]) => mockSharedLinkUpdate(...args),
      delete: (...args: any[]) => mockSharedLinkDelete(...args),
      deleteMany: (...args: any[]) => mockSharedLinkDeleteMany(...args),
      findUnique: (...args: any[]) => mockSharedLinkFindUnique(...args),
    },
    file: {
      findUnique: (...args: any[]) => mockFileFindUnique(...args),
    },
  },
}));

function lastAuditCall() {
  const call = mockAuditLogCreate.mock.calls.at(-1);
  return call ? call[0].data : undefined;
}

describe('Audit logging for authentication events (Issue 176)', () => {
  beforeEach(() => {
    cookiesMock = {};
    currentSessionUser = null;
    vi.clearAllMocks();
    // Share routes now gate on checkFileAccess (PR #204); default to allowed
    // so existing scenarios don't need to opt in individually.
    mockCheckFileAccess.mockResolvedValue(true);
  });

  describe('POST /api/auth/login', () => {
    it('logs auth:login:success with teamId null on successful login', async () => {
      const mockUser = {
        id: 'user-success',
        email: 'success-176@collabpro.com',
        name: 'Success User',
        password: await bcrypt.hash('correct-password', 10),
      };
      mockUserFindUnique.mockResolvedValueOnce(mockUser);

      const req = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.1.1.1' },
        body: JSON.stringify({ email: mockUser.email, password: 'correct-password' }),
      });

      const res = await loginPOST(req);
      expect(res.status).toBe(200);

      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
      const logged = lastAuditCall();
      expect(logged.action).toBe('auth:login:success');
      expect(logged.teamId).toBeNull();
      expect(logged.userEmail).toBe(mockUser.email);
      expect(logged.ipAddress).toBe('10.1.1.1');
    });

    it('logs auth:login:failure on wrong password and never includes the password anywhere', async () => {
      const mockUser = {
        id: 'user-wrongpw',
        email: 'wrongpw-176@collabpro.com',
        name: 'Wrong Pw User',
        password: await bcrypt.hash('correct-password', 10),
      };
      mockUserFindUnique.mockResolvedValueOnce(mockUser);

      const req = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.1.1.2' },
        body: JSON.stringify({ email: mockUser.email, password: 'totally-wrong-password' }),
      });

      const res = await loginPOST(req);
      expect(res.status).toBe(401);

      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
      const logged = lastAuditCall();
      expect(logged.action).toBe('auth:login:failure');
      expect(logged.teamId).toBeNull();
      expect(logged.userEmail).toBe(mockUser.email);
      expect(JSON.stringify(logged)).not.toContain('totally-wrong-password');
      expect(JSON.stringify(logged)).not.toContain('correct-password');
    });

    it('logs auth:login:failure for an unknown email without leaking the submitted password', async () => {
      mockUserFindUnique.mockResolvedValueOnce(null);

      const req = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'ghost-176@collabpro.com', password: 'whatever-secret' }),
      });

      const res = await loginPOST(req);
      expect(res.status).toBe(401);

      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
      const logged = lastAuditCall();
      expect(logged.action).toBe('auth:login:failure');
      expect(JSON.stringify(logged)).not.toContain('whatever-secret');
    });

    it('logs auth:login:rate-limited once the login attempt cap is exceeded, still without leaking the password', async () => {
      mockUserFindUnique.mockResolvedValue(null);
      const email = 'rate-limited-176@collabpro.com';
      const ip = '10.1.1.99';

      let res;
      for (let i = 0; i < 6; i++) {
        const req = new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
          body: JSON.stringify({ email, password: `attempt-secret-${i}` }),
        });
        res = await loginPOST(req);
      }

      expect(res!.status).toBe(429);
      const logged = lastAuditCall();
      expect(logged.action).toBe('auth:login:rate-limited');
      expect(logged.teamId).toBeNull();
      expect(logged.userEmail).toBe(email);
      expect(JSON.stringify(logged)).not.toMatch(/attempt-secret-\d/);
    });

    it('does not write one audit row per rejected attempt once rate-limited (P1: write amplification)', async () => {
      // The rate limiter exists to bound load during an attack. If every
      // single 429 also triggers an awaited DB write, an attacker hammering
      // a blocked endpoint turns the limiter into an unbounded audit-log
      // write amplifier instead. Only the request that first trips the
      // limit should be logged.
      mockUserFindUnique.mockResolvedValue(null);
      const email = 'write-amplification-176@collabpro.com';
      const ip = '10.1.1.100';
      const totalAttempts = 20;

      let lastRes;
      for (let i = 0; i < totalAttempts; i++) {
        const req = new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
          body: JSON.stringify({ email, password: `attempt-${i}` }),
        });
        lastRes = await loginPOST(req);
      }

      expect(lastRes!.status).toBe(429);

      const rateLimitedCalls = mockAuditLogCreate.mock.calls.filter(
        (call: any[]) => call[0].data.action === 'auth:login:rate-limited'
      );
      expect(rateLimitedCalls.length).toBeLessThan(totalAttempts);
      expect(rateLimitedCalls.length).toBe(1);
    });
  });

  describe('POST /api/auth/register', () => {
    it('logs auth:register on successful registration without leaking the password', async () => {
      mockUserFindUnique.mockResolvedValueOnce(null);
      mockUserCreate.mockImplementationOnce((args: any) => ({
        id: 'new-user-176',
        name: args.data.name,
        email: args.data.email,
        password: args.data.password,
        image: args.data.image,
      }));

      const req = new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.1.1.3' },
        body: JSON.stringify({ name: 'New User 176', email: 'newuser-176@collabpro.com', password: 'super-secret-pw' }),
      });

      const res = await registerPOST(req);
      expect(res.status).toBe(200);

      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
      const logged = lastAuditCall();
      expect(logged.action).toBe('auth:register');
      expect(logged.teamId).toBeNull();
      expect(logged.userEmail).toBe('newuser-176@collabpro.com');
      expect(logged.ipAddress).toBe('10.1.1.3');
      expect(JSON.stringify(logged)).not.toContain('super-secret-pw');
    });

    it('logs auth:register:duplicate-email when the email is already registered', async () => {
      mockUserFindUnique.mockResolvedValueOnce({ id: 'existing-176', email: 'dupe-176@collabpro.com' });

      const req = new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.1.1.10' },
        body: JSON.stringify({ name: 'Dupe User', email: 'dupe-176@collabpro.com', password: 'whatever-secret-pw' }),
      });

      const res = await registerPOST(req);
      expect(res.status).toBe(400);

      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
      const logged = lastAuditCall();
      expect(logged.action).toBe('auth:register:duplicate-email');
      expect(logged.teamId).toBeNull();
      expect(logged.userEmail).toBe('dupe-176@collabpro.com');
      expect(mockUserCreate).not.toHaveBeenCalled();
      expect(JSON.stringify(logged)).not.toContain('whatever-secret-pw');
    });

    it('logs auth:register:rate-limited without leaking the password, bounding writes to one per window (P1 parity)', async () => {
      mockUserFindUnique.mockResolvedValue(null);
      const email = 'register-rate-limited-176@collabpro.com';
      const ip = '10.1.1.11';
      const totalAttempts = 8; // REGISTER limit is maxAttempts: 3

      let lastRes;
      for (let i = 0; i < totalAttempts; i++) {
        const req = new Request('http://localhost/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
          body: JSON.stringify({ name: 'Attacker', email, password: `attempt-secret-${i}` }),
        });
        lastRes = await registerPOST(req);
      }

      expect(lastRes!.status).toBe(429);

      const rateLimitedCalls = mockAuditLogCreate.mock.calls.filter(
        (call: any[]) => call[0].data.action === 'auth:register:rate-limited'
      );
      expect(rateLimitedCalls.length).toBe(1);
      expect(JSON.stringify(rateLimitedCalls[0][0].data)).not.toMatch(/attempt-secret-\d/);
    });
  });

  describe('GET /api/auth/logout', () => {
    it('logs auth:logout for the authenticated user', async () => {
      const userPayload = { id: 'user-logout', email: 'logout-176@collabpro.com', name: 'Logout User' };
      cookiesMock['session_token'] = signToken(userPayload);

      const req = new Request('http://localhost/api/auth/logout', {
        headers: { 'x-forwarded-for': '10.1.1.4' },
      });

      const res = await logoutGET(req);
      expect(res.status).toBe(307);

      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
      const logged = lastAuditCall();
      expect(logged.action).toBe('auth:logout');
      expect(logged.teamId).toBeNull();
      expect(logged.userEmail).toBe('logout-176@collabpro.com');
      expect(logged.ipAddress).toBe('10.1.1.4');
    });

    it('clears the session cookie before the audit write (P2: must not delay the response on a slow audit DB)', async () => {
      const userPayload = { id: 'user-logout-order', email: 'logout-order-176@collabpro.com', name: 'Logout Order User' };
      cookiesMock['session_token'] = signToken(userPayload);

      const req = new Request('http://localhost/api/auth/logout', {
        headers: { 'x-forwarded-for': '10.1.1.4' },
      });

      await logoutGET(req);

      expect(mockDelete).toHaveBeenCalledWith('session_token');
      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
      // mockDelete must have been invoked strictly before the audit write —
      // otherwise a slow audit DB delays clearing the session.
      const deleteOrder = mockDelete.mock.invocationCallOrder[0];
      const auditOrder = mockAuditLogCreate.mock.invocationCallOrder[0];
      expect(deleteOrder).toBeLessThan(auditOrder);
    });
  });

  describe('POST /api/api-keys', () => {
    it('logs apikey:create with the maskedKey in context but never the raw key', async () => {
      currentSessionUser = { email: 'apikeyuser-176@collabpro.com' };
      mockApiKeyCreate.mockImplementationOnce((args: any) => ({
        id: 'key-176',
        ...args.data,
        createdAt: new Date(),
      }));

      const req = new Request('http://localhost/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.1.1.5' },
        body: JSON.stringify({ name: 'CI Deploy Key' }),
      });

      const res = await apiKeysPOST(req);
      expect(res.status).toBe(200);
      const resJson = await res.json();
      const rawKey: string = resJson.apiKey.key;
      const maskedKey: string = resJson.apiKey.maskedKey;
      expect(rawKey).toMatch(/^collabpro_pat_/);

      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
      const logged = lastAuditCall();
      expect(logged.action).toBe('apikey:create');
      expect(logged.teamId).toBeNull();
      expect(logged.context).toContain('CI Deploy Key');
      expect(logged.context).toContain(maskedKey);
      expect(logged.context).not.toContain(rawKey);
      expect(JSON.stringify(logged)).not.toContain(rawKey);
    });

    it('logs apikey:revoke on delete', async () => {
      currentSessionUser = { email: 'apikeyuser-176@collabpro.com' };
      mockApiKeyFindUnique.mockResolvedValueOnce({
        id: 'key-176',
        userEmail: 'apikeyuser-176@collabpro.com',
        name: 'CI Deploy Key',
        maskedKey: 'collabpro_pat_••••abcdef',
      });
      mockApiKeyDelete.mockResolvedValueOnce({});

      const req = new Request('http://localhost/api/api-keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.1.1.6' },
        body: JSON.stringify({ id: 'key-176' }),
      });

      const res = await apiKeysDELETE(req);
      expect(res.status).toBe(200);

      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
      const logged = lastAuditCall();
      expect(logged.action).toBe('apikey:revoke');
      expect(logged.teamId).toBeNull();
      expect(logged.context).toContain('CI Deploy Key');
    });
  });

  describe('POST /api/share', () => {
    it('logs share:create with the file team id (not null)', async () => {
      currentSessionUser = { email: 'shareuser-176@collabpro.com' };
      mockFileFindUnique.mockResolvedValueOnce({ id: 'file-176', teamId: 'team-abc-176' });
      mockSharedLinkCreate.mockResolvedValueOnce({ id: 'link-176', fileId: 'file-176', role: 'viewer', isActive: true });

      const req = new Request('http://localhost/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.1.1.7' },
        body: JSON.stringify({ fileId: 'file-176', role: 'viewer' }),
      });

      const res = await sharePOST(req);
      expect(res.status).toBe(200);

      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
      const logged = lastAuditCall();
      expect(logged.action).toBe('share:create');
      expect(logged.teamId).toBe('team-abc-176');
      expect(logged.userEmail).toBe('shareuser-176@collabpro.com');
    });

    it('logs share:role-change when updating the role of an existing link', async () => {
      currentSessionUser = { email: 'shareuser-176@collabpro.com' };
      mockSharedLinkFindUnique.mockResolvedValueOnce({ id: 'link-176', fileId: 'file-176', role: 'viewer', isActive: true });
      mockFileFindUnique.mockResolvedValueOnce({ id: 'file-176', teamId: 'team-abc-176' });
      mockSharedLinkUpdate.mockResolvedValueOnce({ id: 'link-176', fileId: 'file-176', role: 'editor', isActive: true });

      const req = new Request('http://localhost/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.1.1.8' },
        body: JSON.stringify({ fileId: 'file-176', sharedLinkId: 'link-176', role: 'editor' }),
      });

      const res = await sharePOST(req);
      expect(res.status).toBe(200);

      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
      const logged = lastAuditCall();
      expect(logged.action).toBe('share:role-change');
      expect(logged.teamId).toBe('team-abc-176');
    });

    it('attributes share:role-change to the team of the link actually updated, not a mismatched fileId in the request body (P2)', async () => {
      // A request could pass a `fileId` that doesn't match the link being
      // updated (stale client state, or a crafted request). The audit
      // record must reflect the real link/file/team being changed, not
      // whatever fileId happened to be in the body.
      currentSessionUser = { email: 'shareuser-176@collabpro.com' };
      mockSharedLinkFindUnique.mockResolvedValueOnce({ id: 'link-176', fileId: 'file-REAL-176', role: 'viewer', isActive: true });
      mockSharedLinkUpdate.mockResolvedValueOnce({ id: 'link-176', fileId: 'file-REAL-176', role: 'editor', isActive: true });
      mockFileFindUnique.mockImplementation((args: any) => {
        if (args.where.id === 'file-REAL-176') {
          return Promise.resolve({ id: 'file-REAL-176', teamId: 'team-REAL-176' });
        }
        return Promise.resolve({ id: 'file-WRONG-176', teamId: 'team-WRONG-176' });
      });

      const req = new Request('http://localhost/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.1.1.8' },
        // Mismatched fileId: does not correspond to link-176's actual file.
        body: JSON.stringify({ fileId: 'file-WRONG-176', sharedLinkId: 'link-176', role: 'editor' }),
      });

      const res = await sharePOST(req);
      expect(res.status).toBe(200);

      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
      const logged = lastAuditCall();
      expect(logged.action).toBe('share:role-change');
      expect(logged.teamId).toBe('team-REAL-176');
      expect(logged.teamId).not.toBe('team-WRONG-176');
    });
  });

  describe('DELETE /api/share', () => {
    it('logs share:revoke with the file team id (not null)', async () => {
      currentSessionUser = { email: 'shareuser-176@collabpro.com' };
      mockSharedLinkFindUnique.mockResolvedValueOnce({ id: 'link-176', fileId: 'file-176' });
      mockFileFindUnique.mockResolvedValueOnce({ id: 'file-176', teamId: 'team-abc-176' });
      mockSharedLinkDeleteMany.mockResolvedValueOnce({ count: 1 });

      const req = new Request('http://localhost/api/share?sharedLinkId=link-176', {
        method: 'DELETE',
        headers: { 'x-forwarded-for': '10.1.1.9' },
      });

      const res = await shareDELETE(req);
      expect(res.status).toBe(200);

      expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
      const logged = lastAuditCall();
      expect(logged.action).toBe('share:revoke');
      expect(logged.teamId).toBe('team-abc-176');
    });
  });

  describe('AuditLog.teamId nullability', () => {
    it('accepts a null teamId when creating an audit log row directly through the Prisma client', async () => {
      mockAuditLogCreate.mockResolvedValueOnce({
        id: 'audit-176',
        teamId: null,
        userEmail: 'schema-176@collabpro.com',
        action: 'auth:login:success',
        context: '{}',
        ipAddress: '1.1.1.1',
        createdAt: new Date(),
      });

      const { prisma } = await import('@/lib/db');
      const result = await prisma.auditLog.create({
        data: {
          teamId: null,
          userEmail: 'schema-176@collabpro.com',
          action: 'auth:login:success',
          context: '{}',
          ipAddress: '1.1.1.1',
        },
      });

      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ teamId: null }),
      });
      expect(result.teamId).toBeNull();
    });
  });
});
