import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/session-auth/jwt';
import { getClientIp } from '@/lib/rate-limiter';
import { logAuditEvent } from '@/lib/audit';

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  const user = sessionToken ? verifyToken(sessionToken) : null;

  // Clear the session before the audit write, and don't await that write:
  // a slow audit DB must not delay clearing the cookie / the redirect
  // response, which would leave the session valid for longer than intended.
  cookieStore.delete('session_token');

  if (user?.email) {
    void logAuditEvent(null, user.email, 'auth:logout', {}, getClientIp(request));
  }

  const { searchParams } = new URL(request.url);
  const redirectUrl = searchParams.get('post_logout_redirect_url') || '/';

  // request.url's origin reflects the app's internal bind address (e.g.
  // 0.0.0.0:8080 in a container), not the public domain, once behind
  // Railway's reverse proxy - the same proxy-header problem getClientIp()
  // in lib/rate-limiter.ts solves for IPs. Forwarded headers carry the real
  // public host/protocol; request.url is only the fallback for local dev.
  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
  const origin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : request.url;

  return NextResponse.redirect(new URL(redirectUrl, origin));
}
