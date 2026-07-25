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

describe('Prisma PostgreSQL Connection Pooling (Issue 194)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.DB_POOL_MAX;
    // db.ts caches the PrismaClient/Pool on globalThis outside of NODE_ENV=production,
    // which would otherwise leak across tests since globalThis isn't reset by resetModules.
    delete (globalThis as any).prisma;
    delete (globalThis as any).pool;
  });

  it('should pass the connection string through unmodified, with no pgbouncer/connection_limit params appended', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';

    // Dynamically import db.ts to trigger initialization logic
    const { prisma } = await import('@/lib/db');

    // Trigger lazy proxy evaluation
    prisma.$connect;

    const { Pool } = await import('pg');
    expect(Pool).toHaveBeenCalled();

    const poolConfig = (Pool as any).mock.calls[0][0];
    expect(poolConfig.connectionString).toBe('postgresql://user:pass@localhost:5432/db');
    expect(poolConfig.connectionString).not.toContain('pgbouncer');
    expect(poolConfig.connectionString).not.toContain('connection_limit');
    expect(poolConfig.idleTimeoutMillis).toBe(30000);
    expect(poolConfig.connectionTimeoutMillis).toBe(5000);
  });

  it('should default pool max to 10 when DB_POOL_MAX is unset', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';

    const { prisma } = await import('@/lib/db');
    prisma.$connect;

    const { Pool } = await import('pg');
    const poolConfig = (Pool as any).mock.calls[0][0];
    expect(poolConfig.max).toBe(10);
  });

  it('should use DB_POOL_MAX to configure pool max when set', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.DB_POOL_MAX = '25';

    const { prisma } = await import('@/lib/db');
    prisma.$connect;

    const { Pool } = await import('pg');
    const poolConfig = (Pool as any).mock.calls[0][0];
    expect(poolConfig.max).toBe(25);
  });

  it('should throw a clear error when DATABASE_URL is not a recognized PostgreSQL connection string', async () => {
    process.env.DATABASE_URL = 'file:./dev.db';

    const { prisma } = await import('@/lib/db');

    expect(() => prisma.$connect).toThrow(/PostgreSQL connection string/);
  });
});
