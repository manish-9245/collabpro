import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashApiKey, verifyApiKey } from '@/lib/api-key-middleware';
import { GET as apiKeysGET, POST as apiKeysPOST, DELETE as apiKeysDELETE } from '@/app/api/api-keys/route';

// Mock database prisma
const mockFindMany = vi.fn();
const mockFindUnique = vi.fn();
const mockCreate = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    apiKey: {
      findMany: (...args: any[]) => mockFindMany(...args),
      findUnique: (...args: any[]) => mockFindUnique(...args),
      create: (...args: any[]) => mockCreate(...args),
      delete: (...args: any[]) => mockDelete(...args),
    },
  },
}));

// Mock getServerSession
const mockGetUser = vi.fn();
vi.mock('@/lib/session-auth/server', () => ({
  getServerSession: () => ({
    getUser: mockGetUser,
  }),
}));

describe('API Key Cryptographic & Middleware Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Cryptographic Hashing Helper (hashApiKey)', () => {
    it('should generate consistent, valid SHA-256 hashes', () => {
      const token = 'collabpro_pat_test_token_123';
      const hash1 = hashApiKey(token);
      const hash2 = hashApiKey(token);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hashes are 64 characters hex
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('API Key Verification Middleware (verifyApiKey)', () => {
    it('should fail fast with 401 when Authorization header is missing', async () => {
      const res = await verifyApiKey(null);
      expect(res.isValid).toBe(false);
      expect(res.error).toBe('Authorization header missing');
      expect(res.statusCode).toBe(401);
    });

    it('should fail fast with 401 when Authorization header format is invalid', async () => {
      const res = await verifyApiKey('invalid_token_format_abc');
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('Invalid authorization format');
      expect(res.statusCode).toBe(401);
    });

    it('should fail fast with 401 when API key prefix is invalid', async () => {
      const res = await verifyApiKey('Bearer broken_pat_abc123');
      expect(res.isValid).toBe(false);
      expect(res.error).toBe('Invalid API key prefix');
      expect(res.statusCode).toBe(401);
    });

    it('should fail with 401 when API key does not exist in the database', async () => {
      mockFindUnique.mockResolvedValueOnce(null);

      const res = await verifyApiKey('Bearer collabpro_pat_not_found');
      expect(res.isValid).toBe(false);
      expect(res.error).toBe('Invalid API key or token has been revoked');
      expect(res.statusCode).toBe(401);
    });

    it('should fail with 401 when API key is expired', async () => {
      const expiredDate = new Date();
      expiredDate.setFullYear(expiredDate.getFullYear() - 1);

      mockFindUnique.mockResolvedValueOnce({
        id: 'key-123',
        userEmail: 'user@collabpro.com',
        hashedKey: hashApiKey('collabpro_pat_expired'),
        expiresAt: expiredDate,
        scope: 'read-write',
      });

      const res = await verifyApiKey('Bearer collabpro_pat_expired');
      expect(res.isValid).toBe(false);
      expect(res.error).toBe('API key has expired');
      expect(res.statusCode).toBe(401);
    });

    it('should accept read-only key on GET read operations', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'key-123',
        userEmail: 'user@collabpro.com',
        hashedKey: hashApiKey('collabpro_pat_read_only'),
        expiresAt: null,
        scope: 'read-only',
      });

      const res = await verifyApiKey('Bearer collabpro_pat_read_only', 'GET');
      expect(res.isValid).toBe(true);
      expect(res.userEmail).toBe('user@collabpro.com');
      expect(res.scope).toBe('read-only');
    });

    it('should block read-only key on write operations (POST, PUT, DELETE, PATCH)', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'key-123',
        userEmail: 'user@collabpro.com',
        hashedKey: hashApiKey('collabpro_pat_read_only'),
        expiresAt: null,
        scope: 'read-only',
      });

      const res = await verifyApiKey('Bearer collabpro_pat_read_only', 'POST');
      expect(res.isValid).toBe(false);
      expect(res.error).toBe('Forbidden: API key has read-only access scope');
      expect(res.statusCode).toBe(403);
    });

    it('should authorize read-write key on both read and write operations', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'key-123',
        userEmail: 'user@collabpro.com',
        hashedKey: hashApiKey('collabpro_pat_read_write'),
        expiresAt: null,
        scope: 'read-write',
      });

      const resGet = await verifyApiKey('Bearer collabpro_pat_read_write', 'GET');
      expect(resGet.isValid).toBe(true);

      const resPost = await verifyApiKey('Bearer collabpro_pat_read_write', 'POST');
      expect(resPost.isValid).toBe(true);
    });
  });

  describe('API Key Route Handlers', () => {
    describe('GET handler', () => {
      it('should return masked API Keys for authenticated user', async () => {
        mockGetUser.mockResolvedValueOnce({ email: 'user@collabpro.com' });
        mockFindMany.mockResolvedValueOnce([
          {
            id: 'key-1',
            name: 'Key One',
            maskedKey: 'collabpro_pat_••••abcdef',
            scope: 'read-write',
            createdAt: new Date(),
            expiresAt: null,
          }
        ]);

        const res = await apiKeysGET();
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.apiKeys).toHaveLength(1);
        expect(body.apiKeys[0].maskedKey).toBe('collabpro_pat_••••abcdef');
        expect(body.apiKeys[0].scope).toBe('read-write');
      });

      it('should return 401 when user is unauthenticated', async () => {
        mockGetUser.mockResolvedValueOnce(null);

        const res = await apiKeysGET();
        expect(res.status).toBe(401);
      });
    });

    describe('POST handler', () => {
      it('should securely generate and hash new API Keys', async () => {
        mockGetUser.mockResolvedValueOnce({ email: 'user@collabpro.com' });
        mockCreate.mockResolvedValueOnce({
          id: 'new-key-id',
          name: 'Secure Token',
          maskedKey: 'collabpro_pat_••••xxxxxx',
          scope: 'read-only',
          createdAt: new Date(),
          expiresAt: null,
        });

        const req = new Request('http://localhost/api/api-keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Secure Token', scope: 'read-only', expiresDays: 30 }),
        });

        const res = await apiKeysPOST(req);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.apiKey.key).toBeDefined();
        expect(body.apiKey.key).toContain('collabpro_pat_');
        expect(body.apiKey.scope).toBe('read-only');

        // Check if database create was called with hashed key
        expect(mockCreate).toHaveBeenCalled();
        const createCallArgs = mockCreate.mock.calls[0][0];
        expect(createCallArgs.data.hashedKey).toBeDefined();
        expect(createCallArgs.data.hashedKey).not.toBe(body.apiKey.key); // Hashed value should be stored, not raw
        expect(createCallArgs.data.scope).toBe('read-only');
      });

      it('should reject POST with missing key name', async () => {
        mockGetUser.mockResolvedValueOnce({ email: 'user@collabpro.com' });

        const req = new Request('http://localhost/api/api-keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: 'read-write' }),
        });

        const res = await apiKeysPOST(req);
        expect(res.status).toBe(400);
      });

      it('should reject POST with invalid scopes', async () => {
        mockGetUser.mockResolvedValueOnce({ email: 'user@collabpro.com' });

        const req = new Request('http://localhost/api/api-keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Hack Key', scope: 'invalid-scope-admin' }),
        });

        const res = await apiKeysPOST(req);
        expect(res.status).toBe(400);
      });
    });

    describe('DELETE handler', () => {
      it('should delete key when owned by current user', async () => {
        mockGetUser.mockResolvedValueOnce({ email: 'user@collabpro.com' });
        mockFindUnique.mockResolvedValueOnce({ id: 'key-1', userEmail: 'user@collabpro.com' });

        const req = new Request('http://localhost/api/api-keys', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'key-1' }),
        });

        const res = await apiKeysDELETE(req);
        expect(res.status).toBe(200);
        expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'key-1' } });
      });

      it('should return 403 when trying to delete another user\'s key', async () => {
        mockGetUser.mockResolvedValueOnce({ email: 'user@collabpro.com' });
        mockFindUnique.mockResolvedValueOnce({ id: 'key-2', userEmail: 'other@collabpro.com' });

        const req = new Request('http://localhost/api/api-keys', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'key-2' }),
        });

        const res = await apiKeysDELETE(req);
        expect(res.status).toBe(403);
        expect(mockDelete).not.toHaveBeenCalled();
      });
    });
  });
});
