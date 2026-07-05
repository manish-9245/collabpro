import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
  const cookieStore = cookies();
  cookieStore.delete('session_token');
  
  const { searchParams } = new URL(request.url);
  const redirectUrl = searchParams.get('post_logout_redirect_url') || '/';
  
  return NextResponse.redirect(new URL(redirectUrl, request.url));
}
