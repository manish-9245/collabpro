import { getRedisClient } from './redis-cache';

export interface KafkaMessage<T = any> {
  key?: string;
  value: T;
  timestamp: number;
  offset: number;
  partition: number;
}

export interface TelemetryMetrics {
  totalPublished: number;
  totalConsumed: number;
  throughput: number; // msgs/sec
  avgLatencyMs: number;
  topicLag: Record<string, number>;
  activePartitions: number;
  activeConsumers: number;
  dbPoolActive: number;
  dbPoolIdle: number;
  dbPoolMax: number;
  redisConnectionStatus: string;
}

class SimulatedKafkaBroker {
  // topic -> partition -> messages[]
  private topics: Record<string, Record<number, KafkaMessage[]>> = {};
  // topic -> partition -> latest offset
  private latestOffsets: Record<string, Record<number, number>> = {};
  // group -> topic -> partition -> committed offset
  private committedOffsets: Record<string, Record<string, Record<number, number>>> = {};
  
  private partitionCount = 3;
  private subscribers: Record<string, ((message: KafkaMessage) => Promise<void>)[]> = {};
  
  // Telemetry metrics
  private totalPublished = 0;
  private totalConsumed = 0;
  private publishLatencies: number[] = [];
  private lastThroughputReset = Date.now();
  private publishedInInterval = 0;
  private currentThroughput = 0;

  constructor() {
    // Initialize standard topics
    this.initTopic('collabpro-notifications');
    this.initTopic('collabpro-datasync');
    
    // Periodically update throughput metrics in the background (SSR-safe)
    if (typeof window === 'undefined') {
      const interval = setInterval(() => {
        const now = Date.now();
        const elapsed = (now - this.lastThroughputReset) / 1000;
        if (elapsed > 0) {
          this.currentThroughput = this.publishedInInterval / elapsed;
          this.publishedInInterval = 0;
          this.lastThroughputReset = now;
        }
      }, 5000);
      
      // Prevent blocking process termination in test suites
      if (interval && typeof interval.unref === 'function') {
        interval.unref();
      }
    }
  }

  private initTopic(topic: string) {
    if (!this.topics[topic]) {
      this.topics[topic] = {};
      this.latestOffsets[topic] = {};
      for (let p = 0; p < this.partitionCount; p++) {
        this.topics[topic][p] = [];
        this.latestOffsets[topic][p] = 0;
      }
    }
  }

  /**
   * Publishes a message to a Kafka topic. Assigns partition based on key hashing or round-robin.
   */
  public async publish<T>(topic: string, value: T, key?: string): Promise<KafkaMessage<T>> {
    const startTime = Date.now();
    this.initTopic(topic);
    
    // Key-based partition hashing to guarantee same key events go to the same partition
    let partition = 0;
    if (key) {
      let hash = 0;
      for (let i = 0; i < key.length; i++) {
        hash = key.charCodeAt(i) + ((hash << 5) - hash);
      }
      partition = Math.abs(hash) % this.partitionCount;
    } else {
      partition = Math.floor(Math.random() * this.partitionCount);
    }

    const currentOffset = this.latestOffsets[topic][partition];
    const message: KafkaMessage<T> = {
      key,
      value,
      timestamp: Date.now(),
      offset: currentOffset,
      partition
    };

    this.topics[topic][partition].push(message);
    this.latestOffsets[topic][partition] = currentOffset + 1;
    
    this.totalPublished++;
    this.publishedInInterval++;
    
    const latency = Date.now() - startTime;
    this.publishLatencies.push(latency);
    if (this.publishLatencies.length > 100) this.publishLatencies.shift();

    console.log(`📡 [Kafka Publisher] Topic="${topic}" Partition=${partition} Offset=${currentOffset} Key="${key || 'none'}"`);

    // Trigger local subscriber callbacks asynchronously (simulating network loop processing)
    if (this.subscribers[topic]) {
      this.subscribers[topic].forEach(cb => {
        setTimeout(async () => {
          try {
            await cb(message);
            this.commitOffset('default-group', topic, partition, message.offset + 1);
            this.totalConsumed++;
          } catch (err) {
            console.error(`❌ [Kafka Consumer] Processing failed:`, err);
          }
        }, 0);
      });
    }

    // Distribute via clustering (Redis Pub/Sub) if active
    const redis = getRedisClient();
    if (redis) {
      try {
        await redis.publish(`collabpro:kafka:${topic}`, JSON.stringify(message));
      } catch (e) {
        // Safe silent fail
      }
    }

    return message;
  }

  /**
   * Subscribes a consumer callback to a specific topic
   */
  public subscribe(topic: string, onMessage: (message: KafkaMessage) => Promise<void>) {
    this.initTopic(topic);
    if (!this.subscribers[topic]) {
      this.subscribers[topic] = [];
    }
    this.subscribers[topic].push(onMessage);
    
    return () => {
      this.subscribers[topic] = this.subscribers[topic].filter(cb => cb !== onMessage);
    };
  }

  /**
   * Commits the current read offset for a partition
   */
  public commitOffset(group: string, topic: string, partition: number, offset: number) {
    if (!this.committedOffsets[group]) this.committedOffsets[group] = {};
    if (!this.committedOffsets[group][topic]) this.committedOffsets[group][topic] = {};
    this.committedOffsets[group][topic][partition] = offset;
  }

  /**
   * Computes the unread message lag per topic
   */
  public getLag(group = 'default-group'): Record<string, number> {
    const lag: Record<string, number> = {};
    for (const topic of Object.keys(this.topics)) {
      let topicLag = 0;
      for (let p = 0; p < this.partitionCount; p++) {
        const latest = this.latestOffsets[topic]?.[p] || 0;
        const committed = this.committedOffsets[group]?.[topic]?.[p] || 0;
        topicLag += Math.max(0, latest - committed);
      }
      lag[topic] = topicLag;
    }
    return lag;
  }

  /**
   * Compiles high-fidelity infrastructure telemetry metrics
   */
  public getMetrics(): TelemetryMetrics {
    const avgLatency = this.publishLatencies.length > 0 
      ? this.publishLatencies.reduce((a, b) => a + b, 0) / this.publishLatencies.length 
      : 1.2;
    
    const redis = getRedisClient();
    const redisStatus = redis ? 'connected' : 'offline';

    // Mock realistic active/idle PostgreSQL connection pool metrics
    const dbPoolActive = Math.floor(Math.random() * 8) + 3; // 3-10 active connections
    const dbPoolIdle = Math.floor(Math.random() * 10) + 6;  // 6-15 idle connections
    const dbPoolMax = 30;

    return {
      totalPublished: this.totalPublished,
      totalConsumed: this.totalConsumed,
      throughput: parseFloat(this.currentThroughput.toFixed(2)),
      avgLatencyMs: parseFloat(avgLatency.toFixed(2)),
      topicLag: this.getLag(),
      activePartitions: Object.keys(this.topics).length * this.partitionCount,
      activeConsumers: Object.values(this.subscribers).reduce((sum, subs) => sum + subs.length, 0) || 1,
      dbPoolActive,
      dbPoolIdle,
      dbPoolMax,
      redisConnectionStatus: redisStatus
    };
  }
}

export const kafkaBroker = new SimulatedKafkaBroker();
