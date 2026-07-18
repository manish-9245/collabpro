import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getServerSession } from '@/lib/session-auth/server';
import { signToken, verifyToken } from '@/lib/session-auth/jwt';
import bcrypt from 'bcryptjs';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { GET as meGET } from '@/app/api/auth/me/route';
import { GET as logoutGET } from '@/app/api/auth/logout/route';

// Mock cookies store
let cookiesMock: Record<string, string> = {};

const mockGet = vi.fn((name: string) => {
  return cookiesMock[name] ? { name, value: cookiesMock[name] } : undefined;
});

const mockSet = vi.fn((name: string, value: string, options?: any) => {
  cookiesMock[name] = value;
});

const mockDelete = vi.fn((name: string) => {
  delete cookiesMock[name];
});

// Mock next/headers
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: mockGet,
    set: mockSet,
    delete: mockDelete,
  }),
}));

// Mock prisma database
const mockFindUnique = vi.fn();
const mockCreate = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
      create: (...args: any[]) => mockCreate(...args),
    },
  },
}));

describe('Authentication & Session Management', () => {
  beforeEach(() => {
    cookiesMock = {};
    vi.clearAllMocks();
  });

  describe('Session Server Helper (getServerSession)', () => {
    it('should return isAuthenticated true and user details when session_token is present', async () => {
      const userPayload = {
        id: 'user-123',
        email: 'test@collabpro.com',
        name: 'Test User',
        image: 'https://example.com/image.jpg',
      };
      cookiesMock['session_token'] = signToken(userPayload);

      const session = getServerSession();
      const authenticated = await session.isAuthenticated();
      const user = await session.getUser();

      expect(authenticated).toBe(true);
      expect(user).toEqual({
        id: 'user-123',
        email: 'test@collabpro.com',
        given_name: 'Test User',
        picture: 'https://example.com/image.jpg',
      });
    });

    it('should return isAuthenticated false and user null when session_token is absent', async () => {
      const session = getServerSession();
      const authenticated = await session.isAuthenticated();
      const user = await session.getUser();

      expect(authenticated).toBe(false);
      expect(user).toBeNull();
    });

    it('should handle malformed JSON session gracefully and return null user', async () => {
      cookiesMock['session_token'] = 'invalid-json-string';

      const session = getServerSession();
      const authenticated = await session.isAuthenticated();
      const user = await session.getUser();

      expect(authenticated).toBe(false); // Cookie is invalid
      expect(user).toBeNull(); // Parsing failed
    });

    it('should reject unencrypted raw JSON session cookie (forgery prevention)', async () => {
      const forgedPayload = {
        id: 'user-forged',
        email: 'attacker@collabpro.com',
        name: 'Attacker User',
      };
      cookiesMock['session_token'] = JSON.stringify(forgedPayload);

      const session = getServerSession();
      const user = await session.getUser();

      expect(user).toBeNull();
    });
  });

  describe('/api/auth/login handler', () => {
    it('should login with valid credentials and set session cookie', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@collabpro.com',
        name: 'Test User',
        password: await bcrypt.hash('correct-password', 10),
        image: 'https://example.com/image.jpg',
      };

      mockFindUnique.mockResolvedValueOnce(mockUser);

      const requestBody = { email: 'test@collabpro.com', password: 'correct-password' };
      const req = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const res = await loginPOST(req);
      expect(res.status).toBe(200);

      const resJson = await res.json();
      expect(resJson.success).toBe(true);
      expect(resJson.user.email).toBe('test@collabpro.com');

      // Verify cookie was set
      expect(mockSet).toHaveBeenCalled();
      expect(cookiesMock['session_token']).toBeDefined();
      expect(verifyToken(cookiesMock['session_token'])).toEqual({
        id: 'user-123',
        email: 'test@collabpro.com',
        name: 'Test User',
        image: 'https://example.com/image.jpg',
      });
    });

    it('should reject login when user does not exist', async () => {
      mockFindUnique.mockResolvedValueOnce(null);

      const requestBody = { email: 'nonexistent@collabpro.com', password: 'password123' };
      const req = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const res = await loginPOST(req);
      expect(res.status).toBe(401);

      const resJson = await res.json();
      expect(resJson.error).toBe('Invalid email or password');
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('should reject login with incorrect password', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@collabpro.com',
        name: 'Test User',
        password: await bcrypt.hash('correct-password', 10),
      };

      mockFindUnique.mockResolvedValueOnce(mockUser);

      const requestBody = { email: 'test@collabpro.com', password: 'wrong-password' };
      const req = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const res = await loginPOST(req);
      expect(res.status).toBe(401);

      const resJson = await res.json();
      expect(resJson.error).toBe('Invalid email or password');
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('should return 400 when email or password is missing', async () => {
      const req = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@collabpro.com' }),
      });

      const res = await loginPOST(req);
      expect(res.status).toBe(400);

      const resJson = await res.json();
      expect(resJson.error).toBe('Email and password are required');
    });
  });

  describe('/api/auth/register handler', () => {
    it('should register a new user and set session cookie', async () => {
      mockFindUnique.mockResolvedValueOnce(null); // No existing user
      const createdUser = {
        id: 'new-user-123',
        name: 'New User',
        email: 'new@collabpro.com',
        password: 'password123',
        image: 'https://api.dicebear.com/7.x/initials/svg?seed=New%20User',
      };
      mockCreate.mockResolvedValueOnce(createdUser);

      const requestBody = { name: 'New User', email: 'new@collabpro.com', password: 'password123' };
      const req = new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const res = await registerPOST(req);
      expect(res.status).toBe(200);

      const resJson = await res.json();
      expect(resJson.success).toBe(true);
      expect(resJson.user.email).toBe('new@collabpro.com');

      expect(mockSet).toHaveBeenCalled();
      expect(cookiesMock['session_token']).toBeDefined();
    });

    it('should hash the password before saving and not return password in response', async () => {
      mockFindUnique.mockResolvedValueOnce(null);
      mockCreate.mockImplementationOnce((args) => {
        return {
          id: 'new-user-123',
          name: args.data.name,
          email: args.data.email,
          password: args.data.password,
          image: args.data.image,
        };
      });

      const requestBody = { name: 'New User', email: 'new@collabpro.com', password: 'password123' };
      const req = new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const res = await registerPOST(req);
      expect(res.status).toBe(200);

      const resJson = await res.json();
      expect(resJson.success).toBe(true);
      expect(resJson.user.password).toBeUndefined();

      expect(mockCreate).toHaveBeenCalled();
      const createCallArgs = mockCreate.mock.calls[0][0];
      const savedPassword = createCallArgs.data.password;
      expect(savedPassword).not.toBe('password123');
      expect(savedPassword.length).toBeGreaterThan(20);
    });

    it('should reject registration when email is already registered', async () => {
      mockFindUnique.mockResolvedValueOnce({ id: 'existing-123', email: 'already@collabpro.com' });

      const requestBody = { name: 'New User', email: 'already@collabpro.com', password: 'password123' };
      const req = new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const res = await registerPOST(req);
      expect(res.status).toBe(400);

      const resJson = await res.json();
      expect(resJson.error).toBe('User with this email already exists');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should return 400 if required fields are missing', async () => {
      const req = new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new@collabpro.com', password: 'password123' }), // missing name
      });

      const res = await registerPOST(req);
      expect(res.status).toBe(400);

      const resJson = await res.json();
      expect(resJson.error).toBe('Name, email, and password are required');
    });
  });

  describe('/api/auth/me handler', () => {
    it('should return user info when valid cookie is provided', async () => {
      const userPayload = {
        id: 'user-123',
        email: 'test@collabpro.com',
        name: 'Test User',
      };
      cookiesMock['session_token'] = signToken(userPayload);

      const res = await meGET();
      expect(res.status).toBe(200);

      const resJson = await res.json();
      expect(resJson.user).toEqual(userPayload);
    });

    it('should return null user when cookie is absent', async () => {
      const res = await meGET();
      expect(res.status).toBe(200);

      const resJson = await res.json();
      expect(resJson.user).toBeNull();
    });
  });

  describe('/api/auth/logout handler', () => {
    it('should delete session cookie and redirect to post_logout_redirect_url', async () => {
      cookiesMock['session_token'] = 'dummy-token';

      const req = new Request('http://localhost/api/auth/logout?post_logout_redirect_url=/login');
      const res = await logoutGET(req);

      expect(mockDelete).toHaveBeenCalledWith('session_token');
      expect(cookiesMock['session_token']).toBeUndefined();
      expect(res.status).toBe(307); // Next.js redirects are usually 307 Temporary Redirect
      expect(res.headers.get('location')).toBe('http://localhost/login');
    });

    it('should default redirect to / when post_logout_redirect_url is not specified', async () => {
      cookiesMock['session_token'] = 'dummy-token';

      const req = new Request('http://localhost/api/auth/logout');
      const res = await logoutGET(req);

      expect(mockDelete).toHaveBeenCalledWith('session_token');
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('http://localhost/');
    });
  });
});
