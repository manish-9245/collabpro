import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/session-auth/jwt';
import { getClientIp } from '@/lib/rate-limiter';
import { logAuditEvent } from '@/lib/audit';

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  const user = sessionToken ? verifyToken(sessionToken) : null;

  if (user?.email) {
    await logAuditEvent(null, user.email, 'auth:logout', {}, getClientIp(request));
  }

  cookieStore.delete('session_token');

  const { searchParams } = new URL(request.url);
  const redirectUrl = searchParams.get('post_logout_redirect_url') || '/';

  return NextResponse.redirect(new URL(redirectUrl, request.url));
}
