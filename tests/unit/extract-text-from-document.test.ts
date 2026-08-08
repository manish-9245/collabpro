import { describe, it, expect } from 'vitest';
import { extractTextFromDocument } from '@/lib/file-service';

describe('lib/file-service extractTextFromDocument', () => {
  it('extracts paragraph/header text and joins list items', () => {
    const doc = JSON.stringify({
      time: 1,
      blocks: [
        { id: 'a', type: 'header', data: { text: 'Title' } },
        { id: 'b', type: 'paragraph', data: { text: 'Some body text.' } },
        { id: 'c', type: 'list', data: { items: ['one', 'two'] } },
      ],
    });
    expect(extractTextFromDocument(doc)).toBe('Title\nSome body text.\none two');
  });

  it('returns empty string for null/undefined/empty input', () => {
    expect(extractTextFromDocument(null)).toBe('');
    expect(extractTextFromDocument(undefined)).toBe('');
    expect(extractTextFromDocument('')).toBe('');
  });

  it('returns empty string for malformed JSON instead of throwing', () => {
    expect(extractTextFromDocument('not-json{')).toBe('');
  });

  it('skips blocks with no usable text/items', () => {
    const doc = JSON.stringify({ blocks: [{ id: 'a', type: 'image', data: { url: 'x.png' } }] });
    expect(extractTextFromDocument(doc)).toBe('');
  });
});
