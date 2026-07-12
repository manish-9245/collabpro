import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database prisma before importing route handlers to prevent Prisma initialization error when env database url is undefined
vi.mock('@/lib/db', () => ({
  prisma: {
    file: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    apiKey: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/session-auth/server', () => ({
  getServerSession: () => ({
    getUser: vi.fn(),
  }),
}));

import { validateAndSanitizeWhiteboardElements } from '@/lib/canvas-validation';

describe('Canvas State Validation & Big Payload Throttling', () => {
  describe('Invalid Delta Schemes', () => {
    it('should throw an error if elements is not an array', () => {
      expect(() => validateAndSanitizeWhiteboardElements('not-an-array' as any)).toThrow('Expected an array of elements');
    });

    it('should pass correct and valid Excalidraw elements', () => {
      const validElements = [
        { id: 'rect-1', type: 'rectangle', x: 100, y: 200, width: 50, height: 60 },
        { id: 'ell-2', type: 'ellipse', x: -50, y: 0, width: 25, height: 25 },
      ];

      const result = validateAndSanitizeWhiteboardElements(validElements);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('rect-1');
    });

    it('should skip elements that are null or missing id or type', () => {
      const mixedElements = [
        null,
        { type: 'rectangle', x: 100, y: 200, width: 50, height: 60 }, // missing id
        { id: 'ell-2', x: -50, y: 0, width: 25, height: 25 }, // missing type
        { id: 'rect-1', type: 'rectangle', x: 100, y: 200, width: 50, height: 60 }, // fully valid
      ];

      const result = validateAndSanitizeWhiteboardElements(mixedElements);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('rect-1');
    });

    it('should throw an error for elements with non-finite or NaN coordinates', () => {
      const invalidCoords = [
        { id: 'rect-1', type: 'rectangle', x: NaN, y: 200, width: 50, height: 60 },
      ];
      expect(() => validateAndSanitizeWhiteboardElements(invalidCoords)).toThrow('has invalid coordinates');

      const infiniteCoords = [
        { id: 'rect-1', type: 'rectangle', x: 100, y: Infinity, width: 50, height: 60 },
      ];
      expect(() => validateAndSanitizeWhiteboardElements(infiniteCoords)).toThrow('has invalid coordinates');
    });

    it('should throw an error for negative width or height dimensions', () => {
      const negativeWidth = [
        { id: 'rect-1', type: 'rectangle', x: 100, y: 200, width: -10, height: 60 },
      ];
      expect(() => validateAndSanitizeWhiteboardElements(negativeWidth)).toThrow('has invalid or negative dimensions');

      const negativeHeight = [
        { id: 'rect-1', type: 'rectangle', x: 100, y: 200, width: 50, height: -5 },
      ];
      expect(() => validateAndSanitizeWhiteboardElements(negativeHeight)).toThrow('has invalid or negative dimensions');
    });
  });

  describe('Big Payload Throttling (DoS Prevention)', () => {
    it('should throw an error if elements list exceeds 5000 elements', () => {
      const giantList = Array.from({ length: 5001 }, (_, i) => ({
        id: `el-${i}`,
        type: 'line',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      }));

      expect(() => validateAndSanitizeWhiteboardElements(giantList)).toThrow('exceeds the maximum allowed elements limit');
    });

    it('should cap points array of an element to 1000 points', () => {
      const giantPoints = Array.from({ length: 1500 }, (_, i) => [i, i]);
      const drawingElement = [
        { id: 'draw-1', type: 'draw', x: 10, y: 10, width: 100, height: 100, points: giantPoints },
      ];

      const result = validateAndSanitizeWhiteboardElements(drawingElement);
      expect(result[0].points).toHaveLength(1000);
    });

    it('should throw error for invalid point coordinate formats', () => {
      const invalidPointData = [
        { id: 'draw-1', type: 'draw', x: 10, y: 10, width: 100, height: 100, points: [[10, 20], 'not-a-coordinate'] },
      ];

      expect(() => validateAndSanitizeWhiteboardElements(invalidPointData)).toThrow('contains invalid point coordinates');
    });
  });
});
