import 'dotenv/config';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as stateSyncPOST } from '@/app/api/state-sync/route';
import { POST as compliancePOST } from '@/app/api/compliance/sonarcloud/route';
import { prisma } from '@/lib/db';

vi.mock('@/lib/session-auth/server', () => {
  return {
    getServerSession: vi.fn(),
  };
});

vi.mock('@/lib/redis-cache', () => {
  return {
    getCachedFile: vi.fn(),
    invalidateCachedFile: vi.fn().mockResolvedValue(undefined),
  };
});

describe('SonarCloud Compliance Integration (Issue #101)', () => {
  async function resetAuthSession(): Promise<void> {
    const { getServerSession } = await import('@/lib/session-auth/server');
    (getServerSession as any).mockImplementation(() => ({
      getUser: vi.fn().mockResolvedValue({ email: 'dev@collabpro.com', given_name: 'Dev User' }),
    }));
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetAuthSession();
    await prisma.sonarcloudSettings.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.user.create({
      data: { email: 'dev@collabpro.com', name: 'Dev User' },
    });
  });

  describe('sonarcloud:getSettings', () => {
    it('should return default empty settings when no config exists for the user', async () => {
      const req = new Request('http://localhost:3000/api/state-sync', {
        method: 'POST',
        body: JSON.stringify({
          path: 'sonarcloud:getSettings',
          args: { userId: 'user-test-1' },
        }),
      });
      const res = await stateSyncPOST(req);
      expect(res.status).toBe(200);
      const data = (await res.json()).data;
      expect(data.userId).toBe('user-test-1');
      expect(data.organization).toBe('');
      expect(data.projectKey).toBe('');
      expect(data.token).toBe('');
    });

    it('should return existing settings when user has saved config', async () => {
      await prisma.sonarcloudSettings.create({
        data: {
          userId: 'user-test-2',
          organization: 'acme-corp',
          projectKey: 'acme-webapp',
          token: 'sct-xxxx',
        },
      });
      const req = new Request('http://localhost:3000/api/state-sync', {
        method: 'POST',
        body: JSON.stringify({
          path: 'sonarcloud:getSettings',
          args: { userId: 'user-test-2' },
        }),
      });
      const res = await stateSyncPOST(req);
      expect(res.status).toBe(200);
      const data = (await res.json()).data;
      expect(data.organization).toBe('acme-corp');
      expect(data.projectKey).toBe('acme-webapp');
    });
  });

  describe('sonarcloud:saveSettings', () => {
    it('should save new SonarCloud settings and persist to database', async () => {
      const req = new Request('http://localhost:3000/api/state-sync', {
        method: 'POST',
        body: JSON.stringify({
          path: 'sonarcloud:saveSettings',
          args: {
            userId: 'user-save-1',
            organization: 'my-org',
            projectKey: 'my-project',
            token: 'sc-token-123',
          },
        }),
      });
      const saveRes = await stateSyncPOST(req);
      expect(saveRes.status).toBe(200);

      const dbRecord = await prisma.sonarcloudSettings.findUnique({
        where: { userId: 'user-save-1' },
      });
      expect(dbRecord).not.toBeNull();
      expect(dbRecord?.organization).toBe('my-org');
      expect(dbRecord?.projectKey).toBe('my-project');
      expect(dbRecord?.token).toBe('sc-token-123');
    });

    it('should update only provided fields keeping existing values intact', async () => {
      await prisma.sonarcloudSettings.create({
        data: {
          userId: 'user-partial',
          organization: 'legacy-org',
          projectKey: 'legacy-project',
          token: 'legacy-token',
        },
      });

      const req = new Request('http://localhost:3000/api/state-sync', {
        method: 'POST',
        body: JSON.stringify({
          path: 'sonarcloud:saveSettings',
          args: { userId: 'user-partial', projectKey: 'refactored-project' },
        }),
      });
      const res = await stateSyncPOST(req);
      expect(res.status).toBe(200);

      const settings = await prisma.sonarcloudSettings.findUnique({
        where: { userId: 'user-partial' },
      });
      expect(settings?.organization).toBe('legacy-org');
      expect(settings?.projectKey).toBe('refactored-project');
      expect(settings?.token).toBe('legacy-token');
    });
  });

  describe('/api/compliance/sonarcloud API route', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    it('should return 401 when no user is authenticated', async () => {
      const gssModule = await import('@/lib/session-auth/server');
      (gssModule.getServerSession as any).mockReturnValue({
        getUser: vi.fn().mockResolvedValue(null),
      });

      const req = new Request('http://localhost:3000/api/compliance/sonarcloud', {
        method: 'POST',
        body: JSON.stringify({ organization: 'my-org', projectKey: 'my-project' }),
      });
      const res = await compliancePOST(req);
      expect(res.status).toBe(401);
    });

    it('should return 400 when organization or projectKey is missing', async () => {
      const req = new Request('http://localhost:3000/api/compliance/sonarcloud', {
        method: 'POST',
        body: JSON.stringify({ organization: 'my-org' }),
      });
      const res = await compliancePOST(req);
      expect(res.status).toBe(400);
    });

    it('should return 400 when token is not configured', async () => {
      await prisma.sonarcloudSettings.create({
        data: {
          userId: 'dev@collabpro.com',
          organization: 'my-org',
          projectKey: 'my-project',
          token: '',
        },
      });

      const req = new Request('http://localhost:3000/api/compliance/sonarcloud', {
        method: 'POST',
        body: JSON.stringify({ organization: 'my-org', projectKey: 'my-project' }),
      });
      const res = await compliancePOST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('token not configured');
    });

    it('should fetch and return metrics from SonarCloud via the compliance route', async () => {
      await prisma.sonarcloudSettings.create({
        data: {
          userId: 'dev@collabpro.com',
          organization: 'my-org',
          projectKey: 'my-project',
          token: 'sct-valid',
        },
      });

      const mockSonarResponse = {
        component: {
          key: 'my-project',
          measures: [
            { metric: 'alert_status', value: 'OK' },
            { metric: 'bugs', value: '3' },
            { metric: 'coverage', value: '92.1' },
          ],
        },
      };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSonarResponse),
      });

      const req = new Request('http://localhost:3000/api/compliance/sonarcloud', {
        method: 'POST',
        body: JSON.stringify({ organization: 'my-org', projectKey: 'my-project' }),
      });
      const res = await compliancePOST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.qualityGate).toBe('OK');
      expect(data.bugs).toBe(3);
      expect(data.coverage).toBe(92.1);
    });
  });

  describe('sonarcloud:getMetrics', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    it('should fetch metrics from SonarCloud and return formatted result', async () => {
      const mockSonarResponse = {
        component: {
          key: 'my-project',
          measures: [
            { metric: 'alert_status', value: 'OK' },
            { metric: 'bugs', value: '3' },
            { metric: 'code_smells', value: '42' },
            { metric: 'coverage', value: '87.5' },
            { metric: 'vulnerabilities', value: '1' },
          ],
        },
      };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSonarResponse),
      });

      const req = new Request('http://localhost:3000/api/state-sync', {
        method: 'POST',
        body: JSON.stringify({
          path: 'sonarcloud:getMetrics',
          args: {
            organization: 'my-org',
            projectKey: 'my-project',
            token: 'sct-valid',
          },
        }),
      });
      const res = await stateSyncPOST(req);
      expect(res.status).toBe(200);
      const data = (await res.json()).data;

      expect(data.qualityGate).toBe('OK');
      expect(data.bugs).toBe(3);
      expect(data.codeSmells).toBe(42);
      expect(data.coverage).toBe(87.5);
      expect(data.vulnerabilities).toBe(1);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('sonarcloud.io/api/measures/component'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringContaining('Basic'),
          }),
        }),
      );
    });

    it('should handle non-ok SonarCloud API response with error fallback', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const req = new Request('http://localhost:3000/api/state-sync', {
        method: 'POST',
        body: JSON.stringify({
          path: 'sonarcloud:getMetrics',
          args: {
            organization: 'my-org',
            projectKey: 'my-project',
            token: 'bad-token',
          },
        }),
      });
      const res = await stateSyncPOST(req);
      expect(res.status).toBe(500);
    });

    it('should fail validation when required args are missing', async () => {
      const req = new Request('http://localhost:3000/api/state-sync', {
        method: 'POST',
        body: JSON.stringify({
          path: 'sonarcloud:getMetrics',
          args: { organization: 'my-org' },
        }),
      });
      const res = await stateSyncPOST(req);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });
  });
});
