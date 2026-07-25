import { describe, it, expect } from 'vitest';
import { FileAccessCache } from '../../ws-server/access-cache';

// Issue #198: cache the access decision per connection+room with a short TTL
// (30-60s), populated on `join`, consulted by the cursor and mutation
// handlers, so cursor messages don't hit the DB at all in steady state.
describe('FileAccessCache (issue #198 — per connection+room TTL cache)', () => {
  it('returns undefined (cache miss) for an unknown connection/file pair', () => {
    const cache = new FileAccessCache(45_000);
    expect(cache.get('conn-1', 'file-1')).toBeUndefined();
  });

  it('returns the cached decision within the TTL window', () => {
    const cache = new FileAccessCache(45_000);
    cache.set('conn-1', 'file-1', true, 1_000);
    expect(cache.get('conn-1', 'file-1', 1_000 + 30_000)).toBe(true);
  });

  it('expires the cached decision once the TTL elapses', () => {
    const cache = new FileAccessCache(45_000);
    cache.set('conn-1', 'file-1', true, 1_000);
    expect(cache.get('conn-1', 'file-1', 1_000 + 46_000)).toBeUndefined();
  });

  it('caches denial as well as approval', () => {
    const cache = new FileAccessCache(45_000);
    cache.set('conn-1', 'file-1', false, 0);
    expect(cache.get('conn-1', 'file-1', 100)).toBe(false);
  });

  it('keeps entries for different connections or files independent', () => {
    const cache = new FileAccessCache(45_000);
    cache.set('conn-1', 'file-1', true, 0);
    cache.set('conn-2', 'file-1', false, 0);
    cache.set('conn-1', 'file-2', false, 0);

    expect(cache.get('conn-1', 'file-1', 0)).toBe(true);
    expect(cache.get('conn-2', 'file-1', 0)).toBe(false);
    expect(cache.get('conn-1', 'file-2', 0)).toBe(false);
  });

  it('invalidateConnection clears only that connection entries', () => {
    const cache = new FileAccessCache(45_000);
    cache.set('conn-1', 'file-1', true, 0);
    cache.set('conn-2', 'file-1', true, 0);

    cache.invalidateConnection('conn-1');

    expect(cache.get('conn-1', 'file-1', 0)).toBeUndefined();
    expect(cache.get('conn-2', 'file-1', 0)).toBe(true);
  });
});
