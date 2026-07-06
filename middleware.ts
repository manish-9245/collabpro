import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getServerSession } from "@/lib/session-auth/server";

// This function can be marked `async` if using `await` inside
export async function middleware(request: NextRequest) {
    const { isAuthenticated } = getServerSession();
    if(!await isAuthenticated())
    {
        return NextResponse.redirect(new URL('/login?post_login_redirect_url=/dashboard', request.url))
    }
}
 
// See "Matching Paths" below to learn more
export const config = {
  matcher: ['/dashboard', '/workspace/:path*'],
}