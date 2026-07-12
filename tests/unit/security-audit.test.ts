import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as securityPOST } from '@/app/api/security-audit/route';
import { processSecurityQueue, enqueueSecurityScan } from '@/lib/security-queue';

// Mock Redis & GitHub client
const mockLPush = vi.fn();
const mockLPop = vi.fn();
vi.mock('@/lib/redis-cache', () => ({
  getRedisClient: vi.fn().mockImplementation(() => ({
    rpush: mockLPush,
    lpop: mockLPop,
  })),
}));

const mockDispatchWorkflow = vi.fn();
vi.mock('@actions/github', () => ({
  getOctokit: () => ({
    rest: {
      actions: {
        createWorkflowDispatch: mockDispatchWorkflow,
      },
    },
  }),
}));

describe('Asynchronous Security Audit & Quality Gate Decoupler (Issue 52)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NOTIFICATION_SECRET = 'ci-secret-token';
  });

  describe('Webhook Ingestion API Gateway', () => {
    it('should reject unauthorized audit webhook dispatches with 401 Unauthorized', async () => {
      const request = new Request('http://localhost:3000/api/security-audit', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer bad-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ commitSha: '123456' }),
      });

      const response = await securityPOST(request);
      expect(response.status).toBe(401);
    });

    it('should ingest valid audit requests, queue them, and return 202 Accepted within 100ms SLA', async () => {
      mockLPush.mockResolvedValueOnce(1);

      const request = new Request('http://localhost:3000/api/security-audit', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ci-secret-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          commitSha: '9614ebcf34ae',
          branch: 'main',
          repository: 'manish-9245/collabpro',
        }),
      });

      const startTime = Date.now();
      const response = await securityPOST(request);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(100); // Webhook handoff SLA
      expect(response.status).toBe(202);

      const body = await response.json();
      expect(body.queued).toBe(true);

      expect(mockLPush).toHaveBeenCalledWith(
        'collabpro:queue:security-scans',
        expect.stringContaining('9614ebcf34ae')
      );
    });
  });

  describe('Asynchronous Worker Pool & Dispatcher', () => {
    it('should pop from queue and dispatch the async GitHub Actions workflow', async () => {
      const payload = {
        commitSha: '9614ebcf34ae',
        branch: 'main',
        repository: 'manish-9245/collabpro',
      };

      mockLPop.mockResolvedValueOnce(JSON.stringify(payload));
      mockDispatchWorkflow.mockResolvedValueOnce({ status: 204 });

      const res = await processSecurityQueue();
      expect(res.dispatchedCount).toBe(1);
      expect(mockDispatchWorkflow).toHaveBeenCalledWith({
        owner: 'manish-9245',
        repo: 'collabpro',
        workflow_id: 'security-scan.yml',
        ref: 'main',
        inputs: {
          commit_sha: '9614ebcf34ae',
        },
      });
    });

    it('should fall back to in-memory queue and gracefully handle Redis push/pop errors', async () => {
      mockLPush.mockRejectedValueOnce(new Error('Redis Down'));
      mockLPop.mockRejectedValueOnce(new Error('Redis Read Fail'));

      const payload = {
        commitSha: '9614ebcf34ae',
        branch: 'main',
        repository: 'manish-9245/collabpro',
      };

      // Test enqueue fallback
      await enqueueSecurityScan(payload);

      // Test dequeue fallback with octokit dispatch
      mockDispatchWorkflow.mockResolvedValueOnce({ status: 204 });
      const res = await processSecurityQueue();
      expect(res.dispatchedCount).toBe(1);
    });

    it('should return 0 dispatched count and log error if GitHub Octokit dispatch fails', async () => {
      const payload = {
        commitSha: '9614ebcf34ae',
        branch: 'main',
        repository: 'manish-9245/collabpro',
      };

      mockLPop.mockResolvedValueOnce(JSON.stringify(payload));
      mockDispatchWorkflow.mockRejectedValueOnce(new Error('GitHub API Outage'));

      const res = await processSecurityQueue();
      expect(res.dispatchedCount).toBe(0);
    });
  });
});
