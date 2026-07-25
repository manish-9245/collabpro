import { NextRequest, NextResponse } from 'next/server';
import { kafkaBroker } from '@/lib/kafka';
import { getServerSession } from '@/lib/session-auth/server';
import { getPgPool } from '@/lib/db';

// Force dynamic execution for real-time telemetry updates
export const dynamic = 'force-dynamic';

// This endpoint exposes global infrastructure metrics (memory, DB pool,
// message-queue state), not per-team data — team ownership or membership is
// not a meaningful authorization boundary for it. Any authenticated user can
// create a team and become its `createdBy` in one click, so gating on that
// (as this route previously did) was equivalent to "any authenticated user."
// Admin status here is deliberately an explicit, operator-managed allowlist
// rather than anything self-serve. Fails closed when unset.
function isAdmin(email: string): boolean {
  const allowlist = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.trim().toLowerCase());
}

export async function GET(req: NextRequest) {
  try {
    const user = await getServerSession().getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdmin(user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Kafka/Redis metrics are real; the fabricated dbPoolActive/dbPoolIdle/dbPoolMax
    // fields from getMetrics() are intentionally not spread through below.
    const {
      dbPoolActive: _fabricatedDbPoolActive,
      dbPoolIdle: _fabricatedDbPoolIdle,
      dbPoolMax: _fabricatedDbPoolMax,
      ...realMetrics
    } = kafkaBroker.getMetrics();

    const dbPoolMax = Number(process.env.DB_POOL_MAX ?? 10);
    const pool = getPgPool();
    const dbPoolStats = pool
      ? {
          dbPoolActive: pool.totalCount - pool.idleCount,
          dbPoolIdle: pool.idleCount,
          dbPoolWaiting: pool.waitingCount,
          dbPoolMax,
        }
      : {
          dbPoolActive: null,
          dbPoolIdle: null,
          dbPoolWaiting: null,
          dbPoolMax,
        };

    const telemetryData = {
      ...realMetrics,
      ...dbPoolStats,
      memoryUsageMB: Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10,
      systemUptimeSeconds: Math.floor(process.uptime()),
    };

    return NextResponse.json(telemetryData);
  } catch (error: any) {
    console.error('[Telemetry API] Failed to aggregate infrastructure health:', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
