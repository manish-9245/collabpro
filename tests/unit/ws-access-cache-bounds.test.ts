import { describe, it, expect } from 'vitest';
import { FileAccessCache } from '../../ws-server/access-cache';

// Group 5 #3 (review round 2, P2): a revoked user could keep sending cursors
// for up to the cache TTL, and the cache had no size bound at all, so a
// client requesting many distinct file ids grows it unbounded. Cap the TTL
// to <=30s (matching the 30s heartbeat interval) and bound the cache size.
describe('FileAccessCache bounds (issue found in review, Group 5 #3)', () => {
  it('default TTL is at most 30s (matching the heartbeat interval)', () => {
    const cache = new FileAccessCache();
    cache.set('conn-1', 'file-1', true, 0);
    // Still cached just under 30s...
    expect(cache.get('conn-1', 'file-1', 29_999)).toBe(true);
    // ...but expired at/after 30s.
    expect(cache.get('conn-1', 'file-1', 30_000)).toBeUndefined();
  });

  it('evicts the oldest entry once the size bound is exceeded, rather than growing unbounded', () => {
    const cache = new FileAccessCache(30_000, 3);
    cache.set('conn-1', 'file-1', true, 0);
    cache.set('conn-1', 'file-2', true, 0);
    cache.set('conn-1', 'file-3', true, 0);
    // Fourth distinct entry exceeds the cap of 3 — oldest (file-1) evicted.
    cache.set('conn-1', 'file-4', true, 0);

    expect(cache.get('conn-1', 'file-1', 0)).toBeUndefined();
    expect(cache.get('conn-1', 'file-2', 0)).toBe(true);
    expect(cache.get('conn-1', 'file-3', 0)).toBe(true);
    expect(cache.get('conn-1', 'file-4', 0)).toBe(true);
  });
});
