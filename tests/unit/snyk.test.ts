import 'dotenv/config';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/state-sync/route';
import { prisma } from '@/lib/db';

vi.mock('@/lib/session-auth/server', () => {
  return {
    getServerSession: vi.fn().mockReturnValue({
      getUser: vi.fn().mockResolvedValue({ email: 'snyk-admin@collabpro.com', given_name: 'Snyk Admin' }),
    }),
  };
});

vi.mock('@/lib/redis-cache', () => {
  return {
    getCachedFile: vi.fn(),
    invalidateCachedFile: vi.fn().mockResolvedValue(undefined),
  };
});

describe('Snyk Security Compliance Integration (Issue 102)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.snykSettings.deleteMany({});
  });

  describe('Settings CRUD via State-Sync', () => {
    it('should return empty settings when no Snyk config exists', async () => {
      const req = new Request('http://localhost:3000/api/state-sync', {
        method: 'POST',
        body: JSON.stringify({
          path: 'snyk:getSettings',
          args: { userEmail: 'snyk-admin@collabpro.com' },
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toBeNull();
    });

    it('should save Snyk settings with token and orgId', async () => {
      const req = new Request('http://localhost:3000/api/state-sync', {
        method: 'POST',
        body: JSON.stringify({
          path: 'snyk:saveSettings',
          args: {
            userId: 'snyk-admin@collabpro.com',
            token: 'snyk-api-token-12345',
            orgId: 'org-abc-123',
          },
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const saved = (await res.json()).data;
      expect(saved.orgId).toBe('org-abc-123');
      expect(saved.token).toBe('snyk-api-token-12345');
      expect(saved.userId).toBe('snyk-admin@collabpro.com');
    });

    it('should retrieve saved Snyk settings', async () => {
      await prisma.snykSettings.create({
        data: {
          userId: 'snyk-admin@collabpro.com',
          orgId: 'org-abc-123',
          token: 'snyk-api-token-12345',
        },
      });

      const req = new Request('http://localhost:3000/api/state-sync', {
        method: 'POST',
        body: JSON.stringify({
          path: 'snyk:getSettings',
          args: { userEmail: 'snyk-admin@collabpro.com' },
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = (await res.json()).data;
      expect(data.orgId).toBe('org-abc-123');
      expect(data.token).toBe('snyk-api-token-12345');
    });

    it('should upsert Snyk settings on repeated saves', async () => {
      await prisma.snykSettings.create({
        data: {
          userId: 'snyk-admin@collabpro.com',
          orgId: 'org-abc-123',
          token: 'snyk-api-token-12345',
        },
      });

      const req = new Request('http://localhost:3000/api/state-sync', {
        method: 'POST',
        body: JSON.stringify({
          path: 'snyk:saveSettings',
          args: {
            userId: 'snyk-admin@collabpro.com',
            token: 'updated-token',
            orgId: 'org-updated',
          },
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const updated = (await res.json()).data;
      expect(updated.token).toBe('updated-token');
      expect(updated.orgId).toBe('org-updated');

      const inDb = await prisma.snykSettings.findUnique({
        where: { userId: 'snyk-admin@collabpro.com' },
      });
      expect(inDb).not.toBeNull();
      expect(inDb!.token).toBe('updated-token');
    });

    it('should delete Snyk settings', async () => {
      await prisma.snykSettings.create({
        data: {
          userId: 'snyk-admin@collabpro.com',
          orgId: 'org-abc-123',
          token: 'snyk-api-token-12345',
        },
      });

      const req = new Request('http://localhost:3000/api/state-sync', {
        method: 'POST',
        body: JSON.stringify({
          path: 'snyk:deleteSettings',
          args: { userEmail: 'snyk-admin@collabpro.com' },
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);

      const inDb = await prisma.snykSettings.findUnique({
        where: { userId: 'snyk-admin@collabpro.com' },
      });
      expect(inDb).toBeNull();
    });
  });

  describe('Snyk API Proxy', () => {
    it('should fetch project metrics via snyk:getMetrics', async () => {
      await prisma.snykSettings.create({
        data: {
          userId: 'snyk-admin@collabpro.com',
          orgId: 'org-abc-123',
          token: 'snyk-api-token-12345',
        },
      });

      const mockProjects = [
        { id: 'proj-1', name: 'frontend-app', issueCountsBySeverity: { critical: 2, high: 5, medium: 3, low: 10 } },
        { id: 'proj-2', name: 'backend-api', issueCountsBySeverity: { critical: 0, high: 1, medium: 8, low: 4 } },
      ];

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/org/org-abc-123/projects')) {
          return new Response(JSON.stringify({ projects: mockProjects }), { status: 200 });
        }
        if (url.includes('/api/v1/org/org-abc-123/project/proj-1/aggregated-issues')) {
          return new Response(JSON.stringify({
            issues: [
              { id: 'iss-1', title: 'XSS vulnerability', severity: 'critical' },
              { id: 'iss-2', title: 'SQL injection', severity: 'critical' },
              { id: 'iss-3', title: 'RCE in dep', severity: 'high' },
              { id: 'iss-4', title: 'Hardcoded secret', severity: 'high' },
              { id: 'iss-5', title: 'Insecure config', severity: 'high' },
              { id: 'iss-6', title: 'Weak cipher', severity: 'medium' },
              { id: 'iss-7', title: 'Info leak', severity: 'medium' },
              { id: 'iss-8', title: 'Minor issue', severity: 'low' },
            ],
          }), { status: 200 });
        }
        if (url.includes('/api/v1/org/org-abc-123/project/proj-2/aggregated-issues')) {
          return new Response(JSON.stringify({
            issues: [
              { id: 'iss-9', title: 'High severity bug', severity: 'high' },
              { id: 'iss-10', title: 'Moderate concern', severity: 'medium' },
              { id: 'iss-11', title: 'Minor lint', severity: 'low' },
            ],
          }), { status: 200 });
        }
        return originalFetch(url);
      });

      const req = new Request('http://localhost:3000/api/state-sync', {
        method: 'POST',
        body: JSON.stringify({
          path: 'snyk:getMetrics',
          args: { userEmail: 'snyk-admin@collabpro.com' },
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const metrics = (await res.json()).data;

      expect(metrics).toHaveProperty('projectCount');
      expect(metrics).toHaveProperty('totalCritical');
      expect(metrics).toHaveProperty('totalHigh');
      expect(metrics).toHaveProperty('totalMedium');
      expect(metrics).toHaveProperty('totalLow');
      expect(metrics).toHaveProperty('securityRating');
      expect(metrics.projectCount).toBe(2);
      expect(metrics.totalCritical).toBe(2);
      expect(metrics.totalHigh).toBe(4);
      expect(metrics.totalMedium).toBe(3);
      expect(metrics.totalLow).toBe(2);

      globalThis.fetch = originalFetch;
    });

    it('should return error when Snyk settings are missing for getMetrics', async () => {
      const req = new Request('http://localhost:3000/api/state-sync', {
        method: 'POST',
        body: JSON.stringify({
          path: 'snyk:getMetrics',
          args: { userEmail: 'snyk-admin@collabpro.com' },
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.message).toContain('Snyk');
    });

    it('should handle Snyk API failures gracefully', async () => {
      await prisma.snykSettings.create({
        data: {
          userId: 'snyk-admin@collabpro.com',
          orgId: 'org-abc-123',
          token: 'bad-token',
        },
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Not authorized' }), { status: 401 })
      );

      const req = new Request('http://localhost:3000/api/state-sync', {
        method: 'POST',
        body: JSON.stringify({
          path: 'snyk:getMetrics',
          args: { userEmail: 'snyk-admin@collabpro.com' },
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.message).toContain('Snyk API');

      globalThis.fetch = vi.fn();
    });
  });
});
