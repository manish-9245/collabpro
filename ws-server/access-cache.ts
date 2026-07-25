/**
 * Per connection+room file-access decision cache with a short TTL (issue
 * #198). Populated on `join`, consulted by the `cursor` handler, so that
 * steady-state cursor traffic — the highest-frequency message type — never
 * hits the database at all.
 *
 * Issue found in review round 2 (Group 5): mutation authorization must NOT
 * share this cache — a revoked team member could otherwise keep writing for
 * up to the TTL window. `checkMutationAuth` in `ws-server/server.ts` always
 * re-checks access fresh (uncached) instead. The TTL here is also capped to
 * <=30s (matching the 30s heartbeat interval) and the cache is bounded in
 * size (oldest-entry eviction) so a client requesting many distinct file ids
 * can't grow it unbounded.
 */

interface CacheEntry {
  allowed: boolean;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_ENTRIES = 200;

export class FileAccessCache {
  private entries = new Map<string, CacheEntry>();
  private ttlMs: number;
  private maxEntries: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS, maxEntries: number = DEFAULT_MAX_ENTRIES) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  private key(connectionId: string, fileId: string): string {
    return `${connectionId}:${fileId}`;
  }

  get(connectionId: string, fileId: string, now: number = Date.now()): boolean | undefined {
    const k = this.key(connectionId, fileId);
    const entry = this.entries.get(k);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(k);
      return undefined;
    }
    return entry.allowed;
  }

  set(connectionId: string, fileId: string, allowed: boolean, now: number = Date.now()): void {
    const k = this.key(connectionId, fileId);
    // Re-inserting moves a key to the end of Map's iteration order, so a
    // plain "delete oldest key" eviction (below) naturally behaves as
    // approximate LRU rather than strict FIFO.
    this.entries.delete(k);
    this.entries.set(k, { allowed, expiresAt: now + this.ttlMs });

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }

  invalidateConnection(connectionId: string): void {
    const prefix = `${connectionId}:`;
    for (const k of this.entries.keys()) {
      if (k.startsWith(prefix)) this.entries.delete(k);
    }
  }
}
