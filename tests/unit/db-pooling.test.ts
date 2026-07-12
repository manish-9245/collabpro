import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pg Pool and PrismaPg adapter
const mockOn = vi.fn();
vi.mock('pg', () => {
  return {
    Pool: vi.fn().mockImplementation(function(this: any, config) {
      this.config = config;
      this.on = mockOn;
    }),
  };
});

vi.mock('@prisma/adapter-pg', () => {
  return {
    PrismaPg: vi.fn().mockImplementation(function(this: any, pool) {
      this.pool = pool;
    }),
  };
});

// Mock PrismaClient to prevent constructor validation errors
vi.mock('@prisma/client', () => {
  return {
    PrismaClient: vi.fn().mockImplementation(function(this: any) {
      // Mock prisma client properties
    }),
  };
});

describe('Prisma pgBouncer Connection Pooling (Issue 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('should parse and append pgbouncer and connection_limit to connection string', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    
    // Dynamically import db.ts to trigger initialization logic
    await import('@/lib/db');
    
    const { Pool } = await import('pg');
    expect(Pool).toHaveBeenCalled();
    
    const poolConfig = (Pool as any).mock.calls[0][0];
    expect(poolConfig.connectionString).toContain('pgbouncer=true');
    expect(poolConfig.connectionString).toContain('connection_limit=50');
    expect(poolConfig.max).toBe(50);
    expect(poolConfig.idleTimeoutMillis).toBe(30000);
    expect(poolConfig.connectionTimeoutMillis).toBe(5000);
  });
});
