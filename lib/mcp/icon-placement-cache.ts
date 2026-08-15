import { randomBytes } from 'crypto';

/**
 * Bridges collabpro_get_library_icon -> collabpro_update_whiteboard without
 * forcing an MCP caller to round-trip an icon's full element geometry
 * (dozens of raw shapes with float coordinates, seeds, groupIds) through its
 * own context twice: once reading the fetch result, once re-emitting it
 * verbatim as the next call's arguments. get_library_icon stashes the
 * already-placed elements here and hands back a short ref instead;
 * update_whiteboard's "iconRefs" resolves them server-side.
 *
 * Single-process in-memory, same tradeoff as icon-libraries.ts's own fetch
 * cache - fine for this app's one-instance-per-Railway-service deployment.
 * Refs are single-use (consumed on read) so resolving the same ref twice
 * can't duplicate an icon's namespaced element IDs onto the board; placing
 * the same icon again just means calling collabpro_get_library_icon again,
 * which is cheap (the underlying library file fetch is itself cached).
 */

const REF_TTL_MS = 30 * 60 * 1000; // long enough for one agent session's diagram build

interface CachedIconPlacement {
  name: string;
  elements: Record<string, unknown>[];
  expiresAt: number;
}

const cache = new Map<string, CachedIconPlacement>();

function purgeExpired(): void {
  const now = Date.now();
  for (const [ref, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(ref);
  }
}

export function storeIconPlacement(name: string, elements: Record<string, unknown>[]): string {
  purgeExpired();
  const ref = `iconref_${randomBytes(8).toString('hex')}`;
  cache.set(ref, { name, elements, expiresAt: Date.now() + REF_TTL_MS });
  return ref;
}

export function takeIconPlacement(ref: string): CachedIconPlacement | null {
  const entry = cache.get(ref);
  cache.delete(ref);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry;
}
