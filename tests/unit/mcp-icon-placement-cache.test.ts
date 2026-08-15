import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { storeIconPlacement, takeIconPlacement } from '@/lib/mcp/icon-placement-cache';

describe('lib/mcp/icon-placement-cache', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips a placement through a ref', () => {
    const elements = [{ id: 'a', type: 'rectangle' }];
    const ref = storeIconPlacement('EC2', elements);
    expect(typeof ref).toBe('string');
    expect(ref.length).toBeGreaterThan(0);

    const placement = takeIconPlacement(ref);
    expect(placement?.name).toBe('EC2');
    expect(placement?.elements).toEqual(elements);
  });

  it('is single-use - a ref cannot be resolved twice', () => {
    const ref = storeIconPlacement('EC2', [{ id: 'a' }]);
    expect(takeIconPlacement(ref)).not.toBeNull();
    expect(takeIconPlacement(ref)).toBeNull();
  });

  it('returns null for an unknown ref', () => {
    expect(takeIconPlacement('iconref_does-not-exist')).toBeNull();
  });

  it('expires a ref after 30 minutes', () => {
    vi.useFakeTimers();
    const ref = storeIconPlacement('EC2', [{ id: 'a' }]);
    vi.advanceTimersByTime(30 * 60 * 1000 + 1);
    expect(takeIconPlacement(ref)).toBeNull();
  });
});
