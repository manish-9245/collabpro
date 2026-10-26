import { describe, it, expect } from 'vitest';
import { ACTIVE_POLL_MS, HIDDEN_POLL_MS, IDLE_AFTER_MS, IDLE_POLL_MS, pollIntervalFor } from '@/lib/state-sync/polling';

describe('state-sync polling cadence (HTTP fallback)', () => {
  it('is no more often than every 15s while the user is active (was 4s)', () => {
    expect(ACTIVE_POLL_MS).toBeGreaterThanOrEqual(15_000);
    expect(pollIntervalFor({ visible: true, msSinceActivity: 0 })).toBe(ACTIVE_POLL_MS);
    expect(pollIntervalFor({ visible: true, msSinceActivity: IDLE_AFTER_MS - 1 })).toBe(ACTIVE_POLL_MS);
  });

  it('backs off once the user has been idle for a minute', () => {
    expect(pollIntervalFor({ visible: true, msSinceActivity: IDLE_AFTER_MS })).toBe(IDLE_POLL_MS);
    expect(IDLE_POLL_MS).toBeGreaterThan(ACTIVE_POLL_MS);
  });

  it('practically pauses in a background tab, regardless of recent activity', () => {
    expect(pollIntervalFor({ visible: false, msSinceActivity: 0 })).toBe(HIDDEN_POLL_MS);
    expect(HIDDEN_POLL_MS).toBeGreaterThan(IDLE_POLL_MS);
  });

  it('a page with several queries stays well under the old request rate', () => {
    const queries = 4; // typical dashboard
    const perMinute = (60_000 / ACTIVE_POLL_MS) * queries;
    const oldPerMinute = (60_000 / 4_000) * queries;
    expect(perMinute).toBeLessThanOrEqual(oldPerMinute / 3);
  });
});
