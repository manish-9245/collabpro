import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createHash } from 'crypto';

function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

export async function POST(request: Request) {
  try {
    const { sharedLinkId, password } = await request.json();

    if (!sharedLinkId || !password) {
      return NextResponse.json({ error: 'Missing sharedLinkId or password' }, { status: 400 });
    }

    const link = await prisma.sharedLink.findUnique({
      where: { id: sharedLinkId }
    });

    if (!link) {
      return NextResponse.json({ error: 'Share link not found' }, { status: 404 });
    }

    // Check expiration
    if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
      return NextResponse.json({ error: 'Share link has expired' }, { status: 410 });
    }

    // Compare hash
    const inputHash = hashPassword(password);
    if (link.passwordHash !== inputHash) {
      return NextResponse.json({ error: 'Incorrect password. Access denied.', success: false }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      data: {
        id: link.id,
        fileId: link.fileId,
        role: link.role
      }
    });
  } catch (err: any) {
    console.error('[API SHARE VERIFY ERROR]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
