import { NextRequest, NextResponse } from 'next/server';
import { kafkaBroker } from '@/lib/kafka';

// Force dynamic execution for real-time telemetry updates
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const metrics = kafkaBroker.getMetrics();
    
    // Simulate minor operational data variations for a lively dashboard
    const telemetryData = {
      ...metrics,
      cpuUsagePercent: parseFloat((Math.sin(Date.now() / 10000) * 10 + 45 + Math.random() * 5).toFixed(1)),
      memoryUsageMB: Math.floor(Math.cos(Date.now() / 15000) * 50 + 1024 + Math.random() * 10),
      networkInBytes: Math.floor(Math.sin(Date.now() / 5000) * 20000 + 150000),
      networkOutBytes: Math.floor(Math.cos(Date.now() / 6000) * 30000 + 250000),
      systemUptimeSeconds: Math.floor(process.uptime()),
    };

    return NextResponse.json(telemetryData);
  } catch (error: any) {
    console.error('❌ [Telemetry API] Failed to aggregate infrastructure health:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
