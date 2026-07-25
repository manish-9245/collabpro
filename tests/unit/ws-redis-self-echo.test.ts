import { describe, it, expect } from 'vitest';
import { isSelfOriginatedMessage } from '../../ws-server/collab-broadcast';

// Group 5 #2 (review round 2, P2): local subscribers received each
// cursor/query-update message TWICE when Redis was active — once via the
// direct local broadcast, and once more when the SAME replica's own Redis
// publish was echoed back to it by its own subscription to
// collabpro:channel:canvas (Redis pub/sub delivers to every subscriber,
// including the publisher itself, if subscribed to the same channel). The
// fix tags every published message with the originating replica's id, and
// skips delivery on the Redis-consume path for messages this exact replica
// published itself (it already delivered them locally).
describe('isSelfOriginatedMessage (issue found in review, Group 5 #2 — no double delivery)', () => {
  it('identifies a message as self-originated when its originId matches this replica', () => {
    expect(isSelfOriginatedMessage({ originId: 'replica-a' }, 'replica-a')).toBe(true);
  });

  it('does not flag a message from a different replica as self-originated', () => {
    expect(isSelfOriginatedMessage({ originId: 'replica-b' }, 'replica-a')).toBe(false);
  });

  it('does not flag a message with no originId as self-originated (backward compatible)', () => {
    expect(isSelfOriginatedMessage({}, 'replica-a')).toBe(false);
  });
});
