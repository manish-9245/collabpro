import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from '@/lib/session-auth/server';

// helper to secure passwords simply
import { createHash } from 'crypto';
function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const fileId = searchParams.get('fileId');
    const sharedLinkId = searchParams.get('sharedLinkId');

    // 1. If retrieving links for a specific file (requires user authentication)
    if (fileId) {
      const session = getServerSession();
      const user = await session.getUser();
      if (!user || !user.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // Fetch active shared links for this file
      const links = await prisma.sharedLink.findMany({
        where: { fileId },
        orderBy: { createdAt: 'desc' }
      });

      return NextResponse.json({ data: links });
    }

    // 2. If checking a specific shared link (public lookup, used during access verification)
    if (sharedLinkId) {
      const link = await prisma.sharedLink.findUnique({
        where: { id: sharedLinkId }
      });

      if (!link) {
        return NextResponse.json({ error: 'Share link not found' }, { status: 404 });
      }

      // Check if link has expired
      if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
        return NextResponse.json({ error: 'This sharing link has expired', expired: true }, { status: 410 });
      }

      // Return link details (omitting sensitive password hash, but indicating password requirement)
      return NextResponse.json({
        data: {
          id: link.id,
          fileId: link.fileId,
          role: link.role,
          requiresPassword: !!link.passwordHash,
          expiresAt: link.expiresAt
        }
      });
    }

    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
  } catch (err: any) {
    console.error('[API SHARE GET ERROR]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = getServerSession();
    const user = await session.getUser();
    if (!user || !user.email) {
      return NextResponse.json({ error: 'Unauthorized: Cookie session required' }, { status: 401 });
    }

    const { fileId, role, password, expiresAt, sharedLinkId, isActive } = await request.json();

    if (!fileId) {
      return NextResponse.json({ error: 'Missing required field: fileId' }, { status: 400 });
    }

    // Hash password if provided
    const passwordHash = password ? hashPassword(password) : null;

    // Convert days offset or ISO string to Date object
    let expiresDateTime: Date | null = null;
    if (expiresAt) {
      expiresDateTime = new Date(expiresAt);
    }

    let link;
    if (sharedLinkId) {
      // Update existing link
      link = await prisma.sharedLink.update({
        where: { id: sharedLinkId },
        data: {
          role: role || 'viewer',
          passwordHash: password ? passwordHash : undefined,
          expiresAt: expiresDateTime,
          isActive: typeof isActive === 'boolean' ? isActive : undefined
        }
      });
    } else {
      // Create new share link
      link = await prisma.sharedLink.create({
        data: {
          fileId,
          role: role || 'viewer',
          passwordHash,
          expiresAt: expiresDateTime,
          isActive: typeof isActive === 'boolean' ? isActive : true
        }
      });
    }

    return NextResponse.json({ data: link });
  } catch (err: any) {
    console.error('[API SHARE POST ERROR]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = getServerSession();
    const user = await session.getUser();
    if (!user || !user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sharedLinkId = searchParams.get('sharedLinkId');

    if (!sharedLinkId) {
      return NextResponse.json({ error: 'Missing sharedLinkId' }, { status: 400 });
    }

    await prisma.sharedLink.delete({
      where: { id: sharedLinkId }
    });

    return NextResponse.json({ success: true, message: 'Share link revoked successfully' });
  } catch (err: any) {
    console.error('[API SHARE DELETE ERROR]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
