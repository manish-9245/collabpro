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

if (globalForPrisma.prisma && globalForPrisma.pool) {
  console.log("[db.ts] Reusing existing global PrismaClient instance");
  prismaInstance = globalForPrisma.prisma;
} else {
  console.log("[db.ts] Creating a new Pool and PrismaClient...");
  try {
    const pool = new Pool({ connectionString });
    
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
    console.log("[db.ts] PrismaClient created successfully");
  } catch (err) {
    console.error("[db.ts] Error constructing PrismaClient with adapter:", err);
    throw err;
  }
}

export const prisma = prismaInstance;





