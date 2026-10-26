import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ACTIVE_POLL_MS, HIDDEN_POLL_MS, IDLE_AFTER_MS, IDLE_POLL_MS, pollIntervalFor } from '@/lib/state-sync/polling';
import { useAdaptiveInterval } from '@/lib/state-sync/react';

describe('state-sync polling cadence (HTTP fallback) - the documented contract', () => {
  it('pins the absolute values: 15s active, 60s idle after 60s, 5 min hidden', () => {
    expect(ACTIVE_POLL_MS).toBe(15_000);
    expect(IDLE_AFTER_MS).toBe(60_000);
    expect(IDLE_POLL_MS).toBe(60_000);
    expect(HIDDEN_POLL_MS).toBe(300_000);
  });

  it('pollIntervalFor maps tab state to the right cadence', () => {
    expect(pollIntervalFor({ visible: true, msSinceActivity: 0 })).toBe(15_000);
    expect(pollIntervalFor({ visible: true, msSinceActivity: IDLE_AFTER_MS - 1 })).toBe(15_000);
    expect(pollIntervalFor({ visible: true, msSinceActivity: IDLE_AFTER_MS })).toBe(60_000);
    expect(pollIntervalFor({ visible: false, msSinceActivity: 0 })).toBe(300_000);
    expect(pollIntervalFor({ visible: false, msSinceActivity: 10 * IDLE_AFTER_MS })).toBe(300_000);
  });

  it('a 4-query page makes at most a third of the old 4s-cadence request rate', () => {
    const perMinute = (60_000 / ACTIVE_POLL_MS) * 4;
    const oldPerMinute = (60_000 / 4_000) * 4;
    expect(perMinute).toBeLessThanOrEqual(oldPerMinute / 3);
  });
});

describe('useAdaptiveInterval (the hook useQuery actually uses)', () => {
  const setVisibility = (state: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('starts active, goes idle after a minute without input, and returns to active on input', () => {
    const { result } = renderHook(() => useAdaptiveInterval());
    expect(result.current).toBe(ACTIVE_POLL_MS);
    act(() => { vi.advanceTimersByTime(IDLE_AFTER_MS + 100); });
    expect(result.current).toBe(IDLE_POLL_MS);
    act(() => { window.dispatchEvent(new Event('touchstart')); });
    expect(result.current).toBe(ACTIVE_POLL_MS);
  });

  it('a hidden tab stays on the 5-minute cadence even after the idle timeout passes', () => {
    const { result } = renderHook(() => useAdaptiveInterval());
    act(() => { setVisibility('hidden'); });
    expect(result.current).toBe(HIDDEN_POLL_MS);
    act(() => { vi.advanceTimersByTime(10 * IDLE_AFTER_MS); });
    expect(result.current).toBe(HIDDEN_POLL_MS); // not overwritten by the idle timer
  });

  it('input in a hidden tab does not restore polling; returning to the tab does', () => {
    const { result } = renderHook(() => useAdaptiveInterval());
    act(() => { setVisibility('hidden'); });
    act(() => { window.dispatchEvent(new Event('mousemove')); });
    expect(result.current).toBe(HIDDEN_POLL_MS);
    act(() => { setVisibility('visible'); });
    expect(result.current).toBe(ACTIVE_POLL_MS); // activity was just now
  });

  it('a query mounted while the tab is hidden starts on the slow cadence', () => {
    setVisibility('hidden');
    const { result } = renderHook(() => useAdaptiveInterval());
    expect(result.current).toBe(HIDDEN_POLL_MS);
  });

  it('coming back to a tab that sat idle resumes at the idle cadence, then input makes it active', () => {
    const { result } = renderHook(() => useAdaptiveInterval());
    act(() => { setVisibility('hidden'); });
    act(() => { vi.advanceTimersByTime(IDLE_AFTER_MS * 3); });
    act(() => { setVisibility('visible'); });
    expect(result.current).toBe(IDLE_POLL_MS);
    act(() => { window.dispatchEvent(new Event('keydown')); });
    expect(result.current).toBe(ACTIVE_POLL_MS);
  });
});
