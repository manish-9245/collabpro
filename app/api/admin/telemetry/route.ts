import { NextRequest, NextResponse } from 'next/server';
import { kafkaBroker } from '@/lib/kafka';
import { getServerSession } from '@/lib/session-auth/server';
import { prisma, getPgPool } from '@/lib/db';

// Force dynamic execution for real-time telemetry updates
export const dynamic = 'force-dynamic';

async function isAdmin(email: string): Promise<boolean> {
  const ownedTeam = await prisma.team.findFirst({ where: { createdBy: email } });
  if (ownedTeam) return true;

  const adminMembership = await prisma.teamMember.findFirst({
    where: { userEmail: email, role: 'admin' },
  });
  return !!adminMembership;
}

export async function GET(req: NextRequest) {
  try {
    const user = await getServerSession().getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = await isAdmin(user.email);
    if (!admin) {
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
