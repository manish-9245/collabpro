import { describe, it, expect } from 'vitest';
import { mergeDocumentBlocks } from '@/app/api/state-sync/services/helpers';

describe('mergeDocumentBlocks deduplication (issue #187)', () => {
  it('does not double the block count when merging the same document twice', () => {
    const doc = {
      time: 1000,
      version: '2.8.1',
      blocks: [
        { id: 'block-1', type: 'paragraph', data: { text: 'Hello' } },
        { id: 'block-2', type: 'paragraph', data: { text: 'World' } },
      ],
    };

    const merged = mergeDocumentBlocks(doc, doc);
    expect(merged.blocks).toHaveLength(2);
    expect(merged.blocks.map((b: any) => b.id)).toEqual(['block-1', 'block-2']);
  });

  it('updates only the edited block in place rather than appending a duplicate', () => {
    const current = {
      time: 1000,
      version: '2.8.1',
      blocks: [
        { id: 'block-1', type: 'paragraph', data: { text: 'Hello' } },
        { id: 'block-2', type: 'paragraph', data: { text: 'World' } },
      ],
    };

    const incoming = {
      time: 2000,
      version: '2.8.1',
      blocks: [
        { id: 'block-1', type: 'paragraph', data: { text: 'Hello, edited' } },
      ],
    };

    const merged = mergeDocumentBlocks(current, incoming);
    expect(merged.blocks).toHaveLength(2);
    expect(merged.blocks.find((b: any) => b.id === 'block-1').data.text).toBe('Hello, edited');
    expect(merged.blocks.find((b: any) => b.id === 'block-2').data.text).toBe('World');
  });

  it('preserves first-seen order and appends genuinely new blocks at the end', () => {
    const current = {
      time: 1000,
      version: '2.8.1',
      blocks: [
        { id: 'block-1', type: 'paragraph', data: { text: 'A' } },
        { id: 'block-2', type: 'paragraph', data: { text: 'B' } },
      ],
    };

    const incoming = {
      time: 2000,
      version: '2.8.1',
      blocks: [
        { id: 'block-2', type: 'paragraph', data: { text: 'B-edited' } },
        { id: 'block-3', type: 'paragraph', data: { text: 'C' } },
      ],
    };

    const merged = mergeDocumentBlocks(current, incoming);
    expect(merged.blocks.map((b: any) => b.id)).toEqual(['block-1', 'block-2', 'block-3']);
    expect(merged.blocks[1].data.text).toBe('B-edited');
  });
});
