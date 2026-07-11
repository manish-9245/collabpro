import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils';

describe('Utility cn Helper', () => {
  it('merges tailwind class names correctly', () => {
    const result = cn('px-2 py-2', 'p-4');
    expect(result).toBe('p-4');
  });

  it('handles conditional classes properly', () => {
    const result = cn('text-red-500', true && 'bg-blue-500', false && 'hidden');
    expect(result).toContain('text-red-500');
    expect(result).toContain('bg-blue-500');
    expect(result).not.toContain('hidden');
  });

  it('returns empty string with undefined or null inputs', () => {
    const result = cn(undefined, null, '');
    expect(result).toBe('');
  });
});
