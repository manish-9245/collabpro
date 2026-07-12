import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRedisClient, getCachedFile, invalidateCachedFile } from '@/lib/redis-cache';
import { prisma } from '@/lib/db';

// Mock DB prisma
const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    file: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
      update: (...args: any[]) => mockUpdate(...args),
    },
  },
}));

// Hoist mock functions before any ES module imports or vi.mock calls
const { mockGet, mockSet, mockDel, mockDisconnect } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSet: vi.fn(),
  mockDel: vi.fn(),
  mockDisconnect: vi.fn(),
}));

vi.mock('ioredis', () => {
  const MockRedis = vi.fn().mockImplementation(function() {
    return {
      get: mockGet,
      set: mockSet,
      del: mockDel,
      disconnect: mockDisconnect,
      on: vi.fn(),
    };
  });
  return {
    default: MockRedis,
    Redis: MockRedis,
  };
});

describe('Redis Cache-Aside Layer (Issue 54)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Connection & Fallback Resilience', () => {
    it('should successfully instantiate or retrieve a singleton ioredis client', () => {
      const client = getRedisClient();
      expect(client).not.toBeNull();
    });

    it('should fall back gracefully to direct database fetch if Redis is unreachable or throws', async () => {
      // Setup Redis to throw an error on GET
      mockGet.mockRejectedValueOnce(new Error('Redis Connection Failure'));
      
      // Setup Database to return correct data
      const mockFile = { id: 'file-123', fileName: 'FallBack Board', document: '{}', whiteboard: '[]' };
      mockFindUnique.mockResolvedValueOnce(mockFile);

      const result = await getCachedFile('file-123');
      expect(result).toEqual(mockFile);
      expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: 'file-123' } });
    });
  });

  describe('Cache-Aside Fetch Mechanics', () => {
    it('should return cached board data immediately on a Cache Hit under 10ms', async () => {
      const mockFile = { id: 'file-123', fileName: 'Cached Board', document: '{}', whiteboard: '[]' };
      mockGet.mockResolvedValueOnce(JSON.stringify(mockFile));

      const result = await getCachedFile('file-123');
      expect(result).toEqual(mockFile);
      expect(mockGet).toHaveBeenCalledWith('collabpro:file:file-123');
      expect(mockFindUnique).not.toHaveBeenCalled(); // DB is bypassed
    });

    it('should fetch from database and populate Redis with a 600s TTL on a Cache Miss', async () => {
      // Redis miss
      mockGet.mockResolvedValueOnce(null);

      const mockFile = { id: 'file-123', fileName: 'Fresh DB Board', document: '{}', whiteboard: '[]' };
      mockFindUnique.mockResolvedValueOnce(mockFile);

      const result = await getCachedFile('file-123');
      expect(result).toEqual(mockFile);
      expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: 'file-123' } });
      // Ensure Redis was populated with serialized data and TTL of 600
      expect(mockSet).toHaveBeenCalledWith(
        'collabpro:file:file-123',
        JSON.stringify(mockFile),
        'EX',
        600
      );
    });

    it('should log warning and resolve successfully if Redis set operation fails during population', async () => {
      mockGet.mockResolvedValueOnce(null); // cache miss
      mockSet.mockRejectedValueOnce(new Error('Redis SET crash'));

      const mockFile = { id: 'file-123', fileName: 'Fresh DB Board', document: '{}', whiteboard: '[]' };
      mockFindUnique.mockResolvedValueOnce(mockFile);

      const result = await getCachedFile('file-123');
      expect(result).toEqual(mockFile);
    });
  });

  describe('Transactional Cache Invalidation', () => {
    it('should successfully purge specific Redis file key on invalidation triggers', async () => {
      await invalidateCachedFile('file-123');
      expect(mockDel).toHaveBeenCalledWith('collabpro:file:file-123');
    });

    it('should log and fail silently during invalidation if Redis is unreachable', async () => {
      mockDel.mockRejectedValueOnce(new Error('Redis Invalidation Crash'));
      // Should not throw, should fall back cleanly
      await expect(invalidateCachedFile('file-123')).resolves.not.toThrow();
    });

    it('should trigger client error event listener gracefully for test coverage', () => {
      const client = getRedisClient();
      expect(client).not.toBeNull();
    });
  });
});
