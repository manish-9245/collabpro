import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { signToken } from '@/lib/session-auth/jwt';
import { checkRateLimit, getClientIp, LIMITS } from '@/lib/rate-limiter';

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    // Cap each source IP first so password spraying across many accounts is
    // throttled, then cap this IP's attempts against this specific account.
    // Keying the per-account bucket on the IP as well means an attacker cannot
    // lock a victim out of their own account from elsewhere.
    const ip = getClientIp(request);
    const ipLimit = checkRateLimit(`login:ip:${ip}`, LIMITS.LOGIN_PER_IP);
    const accountLimit = checkRateLimit(`login:ip-account:${ip}:${email}`, LIMITS.LOGIN);
    if (!ipLimit.allowed || !accountLimit.allowed) {
      const resetAt = Math.max(ipLimit.resetAt, accountLimit.resetAt);
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))) } }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Exclude password from returned user profile to prevent credential leaks
    const { password: _, ...userWithoutPassword } = user;

    const cookieStore = await cookies();
    cookieStore.set('session_token', signToken({
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
    }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 7, // 1 week
      path: '/',
    });

    return NextResponse.json({ success: true, user: userWithoutPassword });
  } catch (error: any) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
