import { NextResponse } from 'next/server';
import { enqueueSecurityScan, SecurityScanPayload } from '@/lib/security-queue';

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.NOTIFICATION_SECRET;
  if (!secret) {
    console.error('NOTIFICATION_SECRET is not configured; refusing to authorize any security-audit request');
    return NextResponse.json({ error: 'Server misconfiguration: quality gate token not set' }, { status: 500 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== secret) {
    return NextResponse.json({ error: 'Unauthorized: Invalid quality gate token' }, { status: 401 });
  }

  try {
    const body: SecurityScanPayload = await req.json();

    if (!body.commitSha || !body.branch || !body.repository) {
      return NextResponse.json({ error: 'Invalid payload: missing parameters' }, { status: 400 });
    }

    // Hand off instantly to consumer queue
    await enqueueSecurityScan(body);

    return NextResponse.json({
      queued: true,
      message: 'Security audit scan request accepted into worker queue pool.',
    }, { status: 202 });
  } catch (error: any) {
    return NextResponse.json({ error: 'Invalid payload format: ' + error.message }, { status: 400 });
  }
}
