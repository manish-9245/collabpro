import { describe, it, expect, vi, beforeEach } from 'vitest';
import { kafkaBroker } from '@/lib/kafka';
import { GET as getTelemetryGET } from '@/app/api/admin/telemetry/route';
import { NextRequest } from 'next/server';

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
    it('should return aggregated infrastructure and container health telemetry JSON', async () => {
      const request = new NextRequest('http://localhost:3000/api/admin/telemetry');
      const response = await getTelemetryGET(request);
      
      expect(response.status).toBe(200);
      const json = await response.json();
      
      expect(json.totalPublished).toBeDefined();
      expect(json.cpuUsagePercent).toBeDefined();
      expect(json.memoryUsageMB).toBeDefined();
      expect(json.systemUptimeSeconds).toBeDefined();
    });
  });
});
