import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from '@/lib/session-auth/server';
import { logAuditEvent } from '@/lib/audit';
import { getClientIp } from '@/lib/rate-limiter';
import { listGrants, revokeGrant } from '@/lib/oauth/store';

// Session-authenticated "Connected apps" API for Settings -> MCP.
export async function GET(): Promise<Response> {
  const user = await getServerSession().getUser();
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ grants: await listGrants(prisma, user.email) });
}

export async function DELETE(request: Request): Promise<Response> {
  const user = await getServerSession().getUser();
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const clientId = new URL(request.url).searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  const revoked = await revokeGrant(prisma, user.email, clientId);
  void logAuditEvent(null, user.email, 'oauth:grant:revoked', { clientId, tokens: revoked }, getClientIp(request));
  return NextResponse.json({ revoked });
}
