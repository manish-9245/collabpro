import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from "@/lib/session-auth/jwt";

export async function middleware(request: NextRequest) {
    const session = request.cookies.get("session_token")?.value;

    // verifyToken throws when SESSION_SECRET is absent. Middleware runs on the
    // Edge runtime, where env vars are inlined at build time, so a build
    // without the secret would otherwise turn every protected request into a
    // 500. Treat any verification failure as unauthenticated instead — the
    // loud failure belongs in signToken, on the login and register paths.
    let isAuthenticated = false;
    if (session) {
        try {
            isAuthenticated = verifyToken(session) !== null;
        } catch {
            isAuthenticated = false;
        }
    }

    if (!isAuthenticated) {
        const loginUrl = new URL('/login', request.url);
        loginUrl.searchParams.set('post_login_redirect_url', request.nextUrl.pathname);
        return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
}

// See "Matching Paths" below to learn more
export const config = {
  matcher: ['/dashboard', '/workspace/:path*'],
}
