import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from '@/lib/session-auth/server';
import { randomBytes } from 'crypto';

export async function GET() {
  try {
    const session = getServerSession();
    const user = await session.getUser();
    if (!user || !user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const apiKeys = await prisma.apiKey.findMany({
      where: { userEmail: user.email },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        key: true, // we will mask this except for the last 4 characters!
        createdAt: true,
        expiresAt: true,
      }
    });

    const maskedKeys = apiKeys.map(k => ({
      ...k,
      key: `collabpro_pat_••••${k.key.slice(-6)}`
    }));

    return NextResponse.json({ apiKeys: maskedKeys });
  } catch (error: any) {
    console.error('[API_KEYS_GET]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = getServerSession();
    const user = await session.getUser();
    if (!user || !user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name, expiresDays } = await request.json();
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Key name is required' }, { status: 400 });
    }

    // Generate secure token
    const tokenBytes = randomBytes(24).toString('hex');
    const secureKey = `collabpro_pat_${tokenBytes}`;

    let expiresAt: Date | null = null;
    if (expiresDays && !isNaN(Number(expiresDays))) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + Number(expiresDays));
    }

    const apiKey = await prisma.apiKey.create({
      data: {
        userEmail: user.email,
        name: name.trim(),
        key: secureKey,
        expiresAt,
      }
    });

    // For POST, we return the raw secret key exactly once
    return NextResponse.json({
      apiKey: {
        id: apiKey.id,
        name: apiKey.name,
        key: secureKey, // Raw key shown only once
        createdAt: apiKey.createdAt,
        expiresAt: apiKey.expiresAt,
      }
    });
  } catch (error: any) {
    console.error('[API_KEYS_POST]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = getServerSession();
    const user = await session.getUser();
    if (!user || !user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: 'Key ID is required' }, { status: 400 });
    }

    // Ensure the key actually belongs to this user before deleting!
    const keyToDelete = await prisma.apiKey.findUnique({
      where: { id }
    });

    if (!keyToDelete || keyToDelete.userEmail !== user.email) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await prisma.apiKey.delete({
      where: { id }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[API_KEYS_DELETE]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
