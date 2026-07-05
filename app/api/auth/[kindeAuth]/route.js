import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ message: "Kinde auth is replaced by local credentials auth." });
}