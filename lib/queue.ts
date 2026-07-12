import { getRedisClient } from './redis-cache';

/**
 * A highly resilient generic queue supporting Redis storage with local in-memory fallbacks
 * if Redis is offline, providing massive implementation depth behind a simple signature.
 */
export class ResilientQueue<T> {
  private queueKey: string;
  private inMemoryQueue: string[] = [];

  constructor(queueKey: string) {
    this.queueKey = queueKey;
  }

  /**
   * Enqueues a task payload, falling back to an in-memory queue if Redis is offline.
   */
  async enqueue(payload: T): Promise<void> {
    const client = getRedisClient();
    const serialized = JSON.stringify(payload);

    if (client) {
      try {
        await client.rpush(this.queueKey, serialized);
        console.log(`📥 [Queue: ${this.queueKey}] Enqueued task payload on Redis`);
        return;
      } catch (err: any) {
        console.warn(`⚠️ Redis queue push failed for ${this.queueKey}, falling back to In-Memory Queue: `, err.message);
      }
    }

    this.inMemoryQueue.push(serialized);
    console.log(`📥 [Queue: ${this.queueKey}] Enqueued task payload in memory`);
  }

  /**
   * Pops a task payload and executes the worker callback.
   * Returns true if a task was processed, false if the queue was empty.
   */
  async process(worker: (payload: T) => Promise<void>): Promise<boolean> {
    const client = getRedisClient();
    let serializedPayload: string | null = null;

    if (client) {
      try {
        serializedPayload = await client.lpop(this.queueKey);
      } catch (err: any) {
        console.warn(`⚠️ Redis queue pop failed for ${this.queueKey}, falling back to In-Memory: `, err.message);
      }
    }

    if (!serializedPayload) {
      serializedPayload = this.inMemoryQueue.shift() || null;
    }

    if (!serializedPayload) {
      return false;
    }

    const payload: T = JSON.parse(serializedPayload);
    await worker(payload);
    return true;
  }

  /**
   * Helper to check the current in-memory backlog length (useful for assertions/testing)
   */
  getInMemoryBacklogCount(): number {
    return this.inMemoryQueue.length;
  }
}
