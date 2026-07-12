import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as dispatchPOST } from '@/app/api/notifications/dispatch/route';
import { processNotificationQueue, enqueueNotification } from '@/lib/notification-queue';

// Mock DB & Redis
vi.mock('@/lib/db', () => ({
  prisma: {},
}));

const mockLPush = vi.fn();
const mockLPop = vi.fn();
vi.mock('@/lib/redis-cache', () => ({
  getRedisClient: vi.fn().mockImplementation(() => ({
    rpush: mockLPush,
    lpop: mockLPop,
  })),
}));

describe('Decoupled Notification Dispatcher (Issue 53)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NOTIFICATION_SECRET = 'super-secret-ci-token';
  });

  describe('Serverless Gateway & Payload Ingestion API', () => {
    it('should reject unauthorized webhook dispatch requests with 401 Unauthorized', async () => {
      const request = new Request('http://localhost:3000/api/notifications/dispatch', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer wrong-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ repository: 'collabpro' }),
      });

      const response = await dispatchPOST(request);
      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toContain('Unauthorized');
    });

    it('should ingest authenticated build reports, enqueue them, and return 202 Accepted quickly', async () => {
      mockLPush.mockResolvedValueOnce(1); // successfully appended to Redis list

      const payload = {
        repository: 'collabpro',
        branch: 'main',
        commit: '9614ebc',
        author: 'CollabPro',
        build: { status: 'success', durationMs: 288000 },
        tests: { passed: 55, total: 55 },
        snyk: { high: 0, medium: 4 },
      };

      const request = new Request('http://localhost:3000/api/notifications/dispatch', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer super-secret-ci-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const startTime = Date.now();
      const response = await dispatchPOST(request);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(100); // SLA verification
      expect(response.status).toBe(202);
      
      const json = await response.json();
      expect(json.queued).toBe(true);
      expect(json.eventId).toBeDefined();

      // Verify enqueuing happened
      expect(mockLPush).toHaveBeenCalledWith(
        'collabpro:queue:notifications',
        expect.any(String)
      );
    });
  });

  describe('Notification Consumer Queue & HTML Compiler', () => {
    it('should pop from queue, compile beautiful build report html, and call delivery', async () => {
      const payload = {
        repository: 'collabpro',
        branch: 'main',
        commit: '9614ebc',
        author: 'CollabPro',
        build: { status: 'success', durationMs: 288000 },
        tests: { passed: 55, total: 55 },
        snyk: { high: 0, medium: 4 },
      };

      // Mock Redis list pop
      mockLPop.mockResolvedValueOnce(JSON.stringify(payload));
      
      const res = await processNotificationQueue();
      expect(res.processedCount).toBe(1);
      expect(res.html).toContain('collabpro');
      expect(res.html?.toLowerCase()).toContain('success');
      expect(res.html).toContain('55/55');
    });

    it('should successfully trigger transient retry backoff logic if delivery service fails', async () => {
      const payload = {
        repository: 'collabpro',
        branch: 'main',
        commit: '9614ebc',
        author: 'CollabPro',
        build: { status: 'failed', durationMs: 120000 },
        tests: { passed: 20, total: 55 },
        snyk: { high: 5, medium: 10 },
      };

      // Force failure during processing
      mockLPop.mockResolvedValueOnce(JSON.stringify(payload));

      const res = await processNotificationQueue({ forceDeliveryFailure: true });
      expect(res.failedCount).toBe(1);
      // Verify retry enqueuing
      expect(mockLPush).toHaveBeenCalledWith(
        'collabpro:queue:notifications',
        expect.stringContaining('"retryCount":1')
      );
    });

    it('should drop notification and trigger dead-letter logic when max retry limit of 5 is reached', async () => {
      const payload = {
        repository: 'collabpro',
        branch: 'main',
        commit: '9614ebc',
        author: 'CollabPro',
        build: { status: 'failed', durationMs: 120000 },
        tests: { passed: 20, total: 55 },
        snyk: { high: 5, medium: 10 },
        retryCount: 5,
      };

      mockLPop.mockResolvedValueOnce(JSON.stringify(payload));

      const res = await processNotificationQueue({ forceDeliveryFailure: true });
      expect(res.failedCount).toBe(1);
      // Verify NO retry enqueuing happens as limit is exhausted
      expect(mockLPush).not.toHaveBeenCalledWith(
        'collabpro:queue:notifications',
        expect.stringContaining('"retryCount":6')
      );
    });

    it('should gracefully handle Redis client throw exceptions and fallback to in-memory queue', async () => {
      mockLPush.mockRejectedValueOnce(new Error('Redis Connection Closed'));
      mockLPop.mockRejectedValueOnce(new Error('Redis Read Timeout'));

      const payload = {
        repository: 'collabpro',
        branch: 'main',
        commit: '9614ebc',
        author: 'CollabPro',
        build: { status: 'success', durationMs: 288000 },
        tests: { passed: 55, total: 55 },
        snyk: { high: 0, medium: 4 },
      };

      // Test enqueue fallback
      await enqueueNotification(payload);

      // Test dequeue fallback
      const res = await processNotificationQueue();
      expect(res.processedCount).toBe(1);
      expect(res.html?.toLowerCase()).toContain('success');
    });
  });
});
