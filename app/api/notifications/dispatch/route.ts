import { NextResponse } from 'next/server';
import { enqueueNotification, NotificationPayload } from '@/lib/notification-queue';

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.NOTIFICATION_SECRET;
  if (!secret) {
    console.error('NOTIFICATION_SECRET is not configured; refusing to authorize any dispatch request');
    return NextResponse.json({ error: 'Server misconfiguration: notification secret not set' }, { status: 500 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== secret) {
    return NextResponse.json({ error: 'Unauthorized: Invalid workflow token' }, { status: 401 });
  }

  try {
    const body: NotificationPayload = await req.json();

    // Hand off instantly to consumer queue abstraction
    await enqueueNotification(body);

    // Return 202 Accepted status inside < 100ms SLA
    return NextResponse.json({
      queued: true,
      eventId: crypto.randomUUID(),
    }, { status: 202 });
  } catch (error: any) {
    return NextResponse.json({ error: 'Invalid notification payload: ' + error.message }, { status: 400 });
  }
}
