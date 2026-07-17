import { describe, it, expect } from 'vitest';
import { encodeCrdtStateAsync, decodeCrdtStateAsync } from '@/lib/crdt';

describe('CRDT Async Web Worker Mock & Thread Fallback', () => {
  it('correctly serializes and deserializes simple state objects asynchronously via synchronous fallback under Node environments', async () => {
    const testState = {
      title: "CollabPro Technical Doc",
      active: true,
      tags: ["system", "mcp", "whiteboard"],
      details: {
        slaMs: 15,
        engine: "yjs"
      }
    };

    const encoded = await encodeCrdtStateAsync(testState);
    expect(encoded).toBeDefined();
    expect(typeof encoded).toBe('string');

    const decoded = await decodeCrdtStateAsync(encoded, {});
    expect(decoded).toEqual(testState);
  });

  it('transparently falls back to default values for null or undefined input states', async () => {
    const decodedEmpty = await decodeCrdtStateAsync(null, { empty: true });
    expect(decodedEmpty).toEqual({ empty: true });
  });

  it('gracefully handles standard JSON non-Yjs fallback states', async () => {
    const rawJsonStr = JSON.stringify({ raw: true });
    const decoded = await decodeCrdtStateAsync(rawJsonStr, {});
    expect(decoded).toEqual({ raw: true });
  });
});
