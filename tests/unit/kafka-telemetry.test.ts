import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { kafkaBroker } from '@/lib/kafka';
import { GET as getTelemetryGET } from '@/app/api/admin/telemetry/route';
import { NextRequest } from 'next/server';

// Mock session auth so the route's admin gate can be exercised deterministically.
const mockGetUser = vi.fn();
vi.mock('@/lib/session-auth/server', () => ({
  getServerSession: () => ({
    getUser: mockGetUser,
  }),
}));

// This route no longer touches prisma for authorization at all — admin
// status is decided purely from the ADMIN_EMAILS env allowlist. Kept as an
// empty mock so any accidental prisma usage fails loudly instead of hitting
// a real database.
let mockPgPool: any = null;
vi.mock('@/lib/db', () => ({
  prisma: {},
  getPgPool: () => mockPgPool,
}));

describe('Apache Kafka Messaging & Super Admin Telemetry API', () => {
  beforeEach(() => {
    // Reset/Setup cluster metrics
    vi.clearAllMocks();
  });

  describe('Simulated Kafka Broker & Partition Hashing Engine', () => {
    it('should successfully publish messages to the specified Kafka topic', async () => {
      const topic = 'collabpro-notifications';
      const value = { event: 'unit-test-run', id: 42 };
      
      const message = await kafkaBroker.publish(topic, value);
      
      expect(message).toBeDefined();
      expect(message.value).toEqual(value);
      expect(message.offset).toBeDefined();
      expect(message.partition).toBeLessThan(3); // 3 partitions configured
    });

    it('should route messages with identical keys to the exact same partition ( Murmur-like Hashing )', async () => {
      const topic = 'collabpro-datasync';
      const key = 'document-session-99';
      
      const msg1 = await kafkaBroker.publish(topic, { data: 'first' }, key);
      const msg2 = await kafkaBroker.publish(topic, { data: 'second' }, key);
      
      expect(msg1.partition).toBe(msg2.partition);
    });

    it('should compute exact topic unread lags based on consumer group committed offsets', () => {
      const topic = 'collabpro-notifications';
      const group = 'test-consumer-group';
      
      const lagBefore = kafkaBroker.getLag(group);
      
      // Commit some offsets
      kafkaBroker.commitOffset(group, topic, 0, 5);
      kafkaBroker.commitOffset(group, topic, 1, 2);
      kafkaBroker.commitOffset(group, topic, 2, 3);
      
      const lagAfter = kafkaBroker.getLag(group);
      expect(lagAfter[topic]).toBeDefined();
    });

    it('should compile highly realistic, dynamic system and connection pool telemetry metrics', () => {
      const metrics = kafkaBroker.getMetrics();
      
      expect(metrics.totalPublished).toBeGreaterThanOrEqual(1);
      expect(metrics.activePartitions).toBe(6); // 2 topics * 3 partitions
      expect(metrics.dbPoolActive).toBeLessThanOrEqual(30);
      expect(metrics.redisConnectionStatus).toBeDefined();
    });
  });

  describe('Super Admin Telemetry REST API Endpoint', () => {
    const ORIGINAL_ADMIN_EMAILS = process.env.ADMIN_EMAILS;

    beforeEach(() => {
      mockGetUser.mockReset();
      mockPgPool = null;
      delete process.env.ADMIN_EMAILS;
    });

    afterEach(() => {
      if (ORIGINAL_ADMIN_EMAILS === undefined) {
        delete process.env.ADMIN_EMAILS;
      } else {
        process.env.ADMIN_EMAILS = ORIGINAL_ADMIN_EMAILS;
      }
    });

    it('should return 401 when there is no authenticated session', async () => {
      mockGetUser.mockResolvedValueOnce(null);

      const request = new NextRequest('http://localhost:3000/api/admin/telemetry');
      const response = await getTelemetryGET(request);

      expect(response.status).toBe(401);
    });

    it('should return 403 when authenticated but not on the ADMIN_EMAILS allowlist', async () => {
      process.env.ADMIN_EMAILS = 'admin@collabpro.com';
      mockGetUser.mockResolvedValueOnce({ id: 'user-1', email: 'nobody@collabpro.com', given_name: 'Nobody', picture: null });

      const request = new NextRequest('http://localhost:3000/api/admin/telemetry');
      const response = await getTelemetryGET(request);

      expect(response.status).toBe(403);
    });

    it('should return 403 for a user who merely owns/created a team — team ownership is not admin status', async () => {
      // This is the exact self-promotion path that was previously exploitable:
      // any authenticated user can create a team via the normal app flow and
      // become its `createdBy`. Owning a team must never be sufficient to
      // reach global infrastructure telemetry.
      process.env.ADMIN_EMAILS = 'someone-else@collabpro.com';
      mockGetUser.mockResolvedValueOnce({ id: 'user-1', email: 'owner-of-a-team@collabpro.com', given_name: 'Owner', picture: null });

      const request = new NextRequest('http://localhost:3000/api/admin/telemetry');
      const response = await getTelemetryGET(request);

      expect(response.status).toBe(403);
    });

    it('should return 403 when ADMIN_EMAILS is unset, even for an authenticated user', async () => {
      // Absence of configuration must fail closed, not open.
      mockGetUser.mockResolvedValueOnce({ id: 'user-1', email: 'anyone@collabpro.com', given_name: 'Anyone', picture: null });

      const request = new NextRequest('http://localhost:3000/api/admin/telemetry');
      const response = await getTelemetryGET(request);

      expect(response.status).toBe(403);
    });

    it('should return 200 with real (non-fabricated) telemetry for a user on the ADMIN_EMAILS allowlist', async () => {
      process.env.ADMIN_EMAILS = 'nobody@example.com, Owner@Collabpro.com ,another@example.com';
      mockGetUser.mockResolvedValueOnce({ id: 'user-1', email: 'owner@collabpro.com', given_name: 'Owner', picture: null });

      const request = new NextRequest('http://localhost:3000/api/admin/telemetry');
      const response = await getTelemetryGET(request);

      expect(response.status).toBe(200);
      const json = await response.json();

      expect(json.totalPublished).toBeDefined();
      expect(json.systemUptimeSeconds).toBeDefined();
      expect(json.memoryUsageMB).toBeTypeOf('number');
      expect(json.memoryUsageMB).toBeGreaterThan(0);

      // Previously fabricated fields must no longer be present.
      expect(json.cpuUsagePercent).toBeUndefined();
      expect(json.networkInBytes).toBeUndefined();
      expect(json.networkOutBytes).toBeUndefined();
    });

    it('should return 200 and report real pg.Pool stats when a pool is available', async () => {
      process.env.ADMIN_EMAILS = 'admin@collabpro.com';
      mockGetUser.mockResolvedValueOnce({ id: 'user-2', email: 'admin@collabpro.com', given_name: 'Admin', picture: null });
      mockPgPool = { totalCount: 12, idleCount: 5, waitingCount: 1 };

      const request = new NextRequest('http://localhost:3000/api/admin/telemetry');
      const response = await getTelemetryGET(request);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.dbPoolActive).toBe(7);
      expect(json.dbPoolIdle).toBe(5);
      expect(json.dbPoolWaiting).toBe(1);
      expect(json.cpuUsagePercent).toBeUndefined();
    });
  });
});
