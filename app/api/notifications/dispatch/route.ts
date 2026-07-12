import { NextResponse } from 'next/server';
import { enqueueNotification, NotificationPayload } from '@/lib/notification-queue';

export async function POST(req: Request): Promise<Response> {
  const authHeader = req.headers.get('Authorization');
  const secret = process.env.NOTIFICATION_SECRET || 'super-secret-ci-token';

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
