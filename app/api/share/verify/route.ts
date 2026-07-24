import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import { checkRateLimit, getClientIp, LIMITS } from '@/lib/rate-limiter';

// Legacy links (created before the bcrypt migration) hold a raw SHA-256 hex
// digest. New/rehashed links always hold a bcrypt hash, which never matches
// this shape (bcrypt hashes start with "$2" and aren't fixed-length hex).
const SHA256_HEX = /^[a-f0-9]{64}$/i;

export async function POST(request: Request) {
  try {
    const { sharedLinkId, password } = await request.json();

    if (!sharedLinkId || !password) {
      return NextResponse.json({ error: 'Missing sharedLinkId or password' }, { status: 400 });
    }

    // Unauthenticated endpoint guessing a password against a known link id,
    // so throttle per (ip, link) before touching the database.
    const ip = getClientIp(request);
    const rateLimit = checkRateLimit(`share-verify:${ip}:${sharedLinkId}`, LIMITS.SHARE_VERIFY);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000))) }
        }
      );
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

    let isValid = false;

    if (link.passwordHash && SHA256_HEX.test(link.passwordHash)) {
      // Legacy unsalted SHA-256 hash. Verify against it, then transparently
      // migrate the row to bcrypt so it's never checked this way again.
      const legacyHash = createHash('sha256').update(password).digest('hex');
      isValid = legacyHash === link.passwordHash;
      if (isValid) {
        const upgradedHash = await bcrypt.hash(password, 10);
        await prisma.sharedLink.update({
          where: { id: link.id },
          data: { passwordHash: upgradedHash }
        });
      }
    } else if (link.passwordHash) {
      isValid = await bcrypt.compare(password, link.passwordHash);
    }

    if (!isValid) {
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
