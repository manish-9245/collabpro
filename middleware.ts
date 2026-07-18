import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from "@/lib/session-auth/jwt";

export async function middleware(request: NextRequest) {
    const session = request.cookies.get("session_token")?.value;
    const isAuthenticated = session ? verifyToken(session) !== null : false;

    if (!isAuthenticated) {
        return NextResponse.redirect(new URL('/login?post_login_redirect_url=/dashboard', request.url))
    }
}
 
// See "Matching Paths" below to learn more
export const config = {
  matcher: ['/dashboard', '/workspace/:path*'],
}