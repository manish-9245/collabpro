import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient; pool: Pool };

let prismaInstance: PrismaClient | null = null;

// Module-level reference to the live pg Pool, kept in sync regardless of
// NODE_ENV, so consumers (e.g. telemetry endpoints) can read real pool
// stats in production too. Not part of the dev-only globalForPrisma cache.
let pgPool: Pool | null = null;

/**
 * Formats a DATABASE_URL for logging without ever leaking credentials.
 * Only the hostname, port, and pathname (database name) are surfaced.
 * Exported for unit testing.
 */
export function formatConnectionLogLine(connectionString: string | undefined): string {
  if (!connectionString) return "[db.ts] DATABASE_URL not set";
  try {
    const u = new URL(connectionString);
    return `[db.ts] Connecting to ${u.hostname}:${u.port}${u.pathname}`;
  } catch {
    return "[db.ts] DATABASE_URL set (unparsable format)";
  }
}

export function getPgPool(): Pool | null {
  return pgPool;
}

function getPrismaInstance(): PrismaClient {
  if (prismaInstance) {
    return prismaInstance;
  }

  console.log("[db.ts] Initializing PrismaClient lazily...");
  let connectionString = process.env.DATABASE_URL;
  console.log(formatConnectionLogLine(connectionString));

  if (connectionString && connectionString.startsWith('prisma+postgres://')) {
    try {
      const url = new URL(connectionString);
      const apiKey = url.searchParams.get('api_key');
      if (apiKey) {
        const decoded = Buffer.from(apiKey, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        if (parsed.databaseUrl) {
          connectionString = parsed.databaseUrl;
          console.log("[db.ts] Parsed base64 databaseUrl successfully");
        }
      }
    } catch (e) {
      console.error("[db.ts] Error parsing prisma+postgres connection string: invalid or unparsable api_key payload");
    }
  }

  const isPostgres = connectionString && (
    connectionString.startsWith("postgresql://") ||
    connectionString.startsWith("postgres://") ||
    connectionString.startsWith("prisma+postgres://")
  );

  if (isPostgres) {
    if (globalForPrisma.prisma && globalForPrisma.pool) {
      console.log("[db.ts] Reusing existing global PostgreSQL PrismaClient instance");
      prismaInstance = globalForPrisma.prisma;
      pgPool = globalForPrisma.pool;
    } else {
      console.log("[db.ts] Creating a new PostgreSQL Pool and PrismaClient...");
      try {
        const pool = new Pool({
          connectionString,
          max: Number(process.env.DB_POOL_MAX ?? 10),
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
          maxUses: 10000,
        });

        pool.on('error', (err) => {
          console.error("[db.ts] Unexpected error on idle client or pool:", err instanceof Error ? err.message : String(err));
          if (process.env.NODE_ENV !== "production") {
            console.log("[db.ts] Clearing stale global PrismaClient and Pool instances...");
            globalForPrisma.prisma = undefined as any;
            globalForPrisma.pool = undefined as any;
            prismaInstance = null;
          }
        });

        const adapter = new PrismaPg(pool);
        prismaInstance = new PrismaClient({ adapter });
        pgPool = pool;

        if (process.env.NODE_ENV !== "production") {
          globalForPrisma.prisma = prismaInstance;
          globalForPrisma.pool = pool;
        }
        console.log("[db.ts] PostgreSQL PrismaClient created successfully");
      } catch (err) {
        console.error("[db.ts] Error constructing PostgreSQL PrismaClient with adapter:", err instanceof Error ? err.message : String(err));
        throw err;
      }
    }
  } else {
    throw new Error("[db.ts] DATABASE_URL must be a PostgreSQL connection string (postgresql://, postgres://, or prisma+postgres://). SQLite is no longer supported.");
  }

  return prismaInstance;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(target, prop, receiver) {
    const instance = getPrismaInstance();
    const value = Reflect.get(instance, prop, receiver);
    if (typeof value === "function") {
      return value.bind(instance);
    }
    return value;
  },
  set(target, prop, value, receiver) {
    const instance = getPrismaInstance();
    return Reflect.set(instance, prop, value, receiver);
  }
});
