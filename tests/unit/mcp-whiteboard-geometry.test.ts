import { describe, it, expect } from 'vitest';
import { validateWhiteboardGeometry } from '@/lib/mcp/tools';

describe('validateWhiteboardGeometry - text and arrow/line rules (collabpro_diagram_guidelines enforcement)', () => {
  describe('text strokeColor', () => {
    it('rejects a text element with no strokeColor - it can render invisible against its background', () => {
      const issues = validateWhiteboardGeometry([
        { id: 't1', type: 'text', x: 0, y: 0, width: 100, height: 20, text: 'Client' },
      ]);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain('missing strokeColor');
      expect(issues[0]).toContain('"Client"');
    });

    it('rejects a text element with an empty-string strokeColor', () => {
      const issues = validateWhiteboardGeometry([
        { id: 't1', type: 'text', x: 0, y: 0, width: 100, height: 20, text: 'Client', strokeColor: '' },
      ]);
      expect(issues.some((i) => i.includes('missing strokeColor'))).toBe(true);
    });

    it('accepts a text element with an explicit strokeColor', () => {
      const issues = validateWhiteboardGeometry([
        { id: 't1', type: 'text', x: 0, y: 0, width: 100, height: 20, text: 'Client', strokeColor: '#1e293b' },
      ]);
      expect(issues).toHaveLength(0);
    });
  });

  describe('arrow/line points and dimensions', () => {
    it('rejects an arrow with fewer than 2 points', () => {
      const issues = validateWhiteboardGeometry([
        { id: 'a1', type: 'arrow', x: 0, y: 0, width: 100, height: 0, points: [[0, 0]] },
      ]);
      expect(issues.some((i) => i.includes('needs at least 2'))).toBe(true);
    });

    it('rejects an arrow missing points entirely', () => {
      const issues = validateWhiteboardGeometry([
        { id: 'a1', type: 'arrow', x: 0, y: 0, width: 100, height: 0 },
      ]);
      expect(issues.some((i) => i.includes('needs at least 2'))).toBe(true);
    });

    it('rejects an arrow with width and height both 0 when points span a real distance', () => {
      const issues = validateWhiteboardGeometry([
        { id: 'a1', type: 'arrow', x: 0, y: 0, width: 0, height: 0, points: [[0, 0], [100, 40]] },
      ]);
      expect(issues.some((i) => i.includes('width and height are both 0'))).toBe(true);
    });

    it('accepts a horizontal arrow with height 0 (the guideline\'s own worked example shape) since width is non-zero', () => {
      const issues = validateWhiteboardGeometry([
        { id: 'a1', type: 'arrow', x: 220, y: 80, width: 100, height: 0, points: [[0, 0], [100, 0]] },
      ]);
      expect(issues).toHaveLength(0);
    });

    it('accepts a vertical line with width 0 since height is non-zero', () => {
      const issues = validateWhiteboardGeometry([
        { id: 'l1', type: 'line', x: 0, y: 0, width: 0, height: 80, points: [[0, 0], [0, 80]] },
      ]);
      expect(issues).toHaveLength(0);
    });

    it('accepts an arrow with a correctly computed non-zero bounding box', () => {
      const issues = validateWhiteboardGeometry([
        { id: 'a1', type: 'arrow', x: 0, y: 0, width: 100, height: 40, points: [[0, 0], [100, 40]] },
      ]);
      expect(issues).toHaveLength(0);
    });
  });
});
