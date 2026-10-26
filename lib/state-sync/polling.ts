/**
 * HTTP-polling cadence for the state-sync fallback (used whenever the
 * WebSocket gateway is not connected). Every mounted useQuery polls on its own
 * timer, so a page with N queries makes N requests per tick - these numbers
 * are deliberately conservative. Real-time collaboration is the WebSocket's
 * job; polling only has to keep a disconnected client roughly fresh, and
 * local edits refetch immediately through the `state-sync:refetch` event.
 */
export const ACTIVE_POLL_MS = 15_000; // tab visible and the user is interacting
export const IDLE_POLL_MS = 60_000; // visible but no input for IDLE_AFTER_MS
export const HIDDEN_POLL_MS = 300_000; // background tab: practically paused
export const IDLE_AFTER_MS = 60_000;

export function pollIntervalFor(input: { visible: boolean; msSinceActivity: number }): number {
  if (!input.visible) return HIDDEN_POLL_MS;
  return input.msSinceActivity >= IDLE_AFTER_MS ? IDLE_POLL_MS : ACTIVE_POLL_MS;
}
