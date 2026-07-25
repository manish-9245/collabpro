/**
 * Per connection+room file-access decision cache with a short TTL (issue
 * #198). Populated on `join`, consulted by the `cursor` and mutation
 * handlers, so that steady-state cursor traffic — the highest-frequency
 * message type — never hits the database at all.
 */

interface CacheEntry {
  allowed: boolean;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 45_000;

export class FileAccessCache {
  private entries = new Map<string, CacheEntry>();
  private ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
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
    this.entries.set(this.key(connectionId, fileId), { allowed, expiresAt: now + this.ttlMs });
  }

  invalidateConnection(connectionId: string): void {
    const prefix = `${connectionId}:`;
    for (const k of this.entries.keys()) {
      if (k.startsWith(prefix)) this.entries.delete(k);
    }
  }
}
