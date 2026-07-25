import { describe, it, expect, vi } from 'vitest';
import { encodeState, decodeState } from '@/lib/state-encode';
import * as legacy from '@/lib/legacy-crdt-decode';

describe('encodeState/decodeState (issue #188 — plain JSON storage, no Yjs on write)', () => {
  it('encodes state as plain JSON.stringify output', () => {
    const state = { time: 1, blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'hi' } }] };
    const encoded = encodeState(state);
    expect(encoded).toBe(JSON.stringify(state));
  });

  it('round-trips a plain-JSON document without going through the legacy Yjs decoder', () => {
    const spy = vi.spyOn(legacy, 'decodeLegacyCrdtState');
    const state = { time: 1, blocks: [] };
    const encoded = encodeState(state);
    const decoded = decodeState(encoded, null);

    expect(decoded).toEqual(state);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('falls back to the legacy Yjs decoder for old {yjs:true,data:...} rows', () => {
    const spy = vi.spyOn(legacy, 'decodeLegacyCrdtState').mockReturnValue({ migrated: true });
    const legacyStored = JSON.stringify({ yjs: true, data: 'irrelevant-for-this-test' });

    const decoded = decodeState(legacyStored, null);

    expect(spy).toHaveBeenCalledWith(legacyStored, null);
    expect(decoded).toEqual({ migrated: true });
    spy.mockRestore();
  });

  it('returns the fallback default for null/undefined/empty input', () => {
    expect(decodeState(null, { empty: true })).toEqual({ empty: true });
    expect(decodeState(undefined, { empty: true })).toEqual({ empty: true });
    expect(decodeState('', { empty: true })).toEqual({ empty: true });
  });
});
