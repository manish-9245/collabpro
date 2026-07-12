import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient; pool: Pool };

let prismaInstance: PrismaClient;

console.log("[db.ts] Initializing PrismaClient...");
let connectionString = process.env.DATABASE_URL;
console.log("[db.ts] Original DATABASE_URL:", connectionString ? connectionString.substring(0, 50) + "..." : "undefined");

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
    console.error("[db.ts] Error parsing prisma+postgres connection string:", e);
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
  } else {
    console.log("[db.ts] Creating a new PostgreSQL Pool and PrismaClient...");
    try {
      // Configure pgBouncer connection parameters dynamically on connection string
      let pooledUrl = connectionString || "";
      try {
        const url = new URL(pooledUrl);
        if (!url.searchParams.has('pgbouncer')) {
          url.searchParams.set('pgbouncer', 'true');
        }
        if (!url.searchParams.has('connection_limit')) {
          url.searchParams.set('connection_limit', '50');
        }
        pooledUrl = url.toString();
      } catch (e) {
        // Fallback to original string if not a parseable URL
      }

      const pool = new Pool({
        connectionString: pooledUrl,
        max: 50, // optimal maximum pool clients per server container instance
        idleTimeoutMillis: 30000, // close idle connections after 30 seconds
        connectionTimeoutMillis: 5000, // wait up to 5 seconds for connection handshake
        maxUses: 10000, // close and recreate connection after 10000 queries to avoid memory leaks
      });
      
      // Handle pool errors to clear stale global instances
      pool.on('error', (err) => {
        console.error("[db.ts] Unexpected error on idle client or pool:", err);
        if (process.env.NODE_ENV !== "production") {
          console.log("[db.ts] Clearing stale global PrismaClient and Pool instances...");
          globalForPrisma.prisma = undefined as any;
          globalForPrisma.pool = undefined as any;
        }
      });

      const adapter = new PrismaPg(pool);
      prismaInstance = new PrismaClient({ adapter });
      
      if (process.env.NODE_ENV !== "production") {
        globalForPrisma.prisma = prismaInstance;
        globalForPrisma.pool = pool;
      }
      console.log("[db.ts] PostgreSQL PrismaClient with pgBouncer pooling created successfully");
    } catch (err) {
      console.error("[db.ts] Error constructing PostgreSQL PrismaClient with adapter:", err);
      throw err;
    }
  }
} else {
  // Database-agnostic fallback (e.g., SQLite, MySQL, CockroachDB, etc.)
  if (globalForPrisma.prisma) {
    console.log("[db.ts] Reusing existing global database-agnostic PrismaClient instance");
    prismaInstance = globalForPrisma.prisma;
  } else {
    console.log("[db.ts] Connection string is non-PostgreSQL. Instantiating standard database-agnostic PrismaClient...");
    try {
      prismaInstance = new PrismaClient({
        datasourceUrl: connectionString || "file:./dev.db"
      } as any);
      if (process.env.NODE_ENV !== "production") {
        globalForPrisma.prisma = prismaInstance;
      }
      console.log("[db.ts] Database-agnostic PrismaClient created successfully");
    } catch (err) {
      console.error("[db.ts] Error constructing database-agnostic PrismaClient:", err);
      throw err;
    }
  }
}

export const prisma = prismaInstance;





