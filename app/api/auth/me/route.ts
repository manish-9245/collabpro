import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/session-auth/jwt';

export async function GET() {
  const cookieStore = await cookies();
  const session = cookieStore.get('session_token')?.value;

  if (!session) {
    return NextResponse.json({ user: null });
  }

  try {
    const user = verifyToken(session);
    if (!user) {
      return NextResponse.json({ user: null });
    }
    return NextResponse.json({ user, token: session });
  } catch {
    return NextResponse.json({ user: null });
  }
}
