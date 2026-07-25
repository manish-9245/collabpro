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

    // Resolve the link before touching the rate limiter. Otherwise a caller
    // spraying junk ids could allocate a rate-limit bucket per garbage
    // string for free; validating existence first keeps buckets bounded to
    // real links.
    const link = await prisma.sharedLink.findUnique({
      where: { id: sharedLinkId }
    });

    if (!link) {
      return NextResponse.json({ error: 'Share link not found' }, { status: 404 });
    }

    // Rate limit: the primary bucket is keyed on the link's own (now
    // DB-confirmed) id, so an attacker cannot reset their budget against a
    // specific link by simply claiming a different x-forwarded-for value on
    // each request. A secondary, more generous per-IP ceiling — same
    // pairing pattern as LOGIN/LOGIN_PER_IP in the login route — catches a
    // single source spraying attempts across many different links; IP alone
    // is never the sole gate since it is client-spoofable.
    const ip = getClientIp(request);
    const linkLimit = checkRateLimit(`share-verify:link:${link.id}`, LIMITS.SHARE_VERIFY);
    const ipLimit = checkRateLimit(`share-verify:ip:${ip}`, LIMITS.SHARE_VERIFY_PER_IP);
    if (!linkLimit.allowed || !ipLimit.allowed) {
      const resetAt = Math.max(linkLimit.resetAt, ipLimit.resetAt);
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))) }
        }
      );
    }

    // Check expiration
    if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
      return NextResponse.json({ error: 'Share link has expired' }, { status: 410 });
    }

    // A link the owner explicitly revoked must not grant access even to
    // someone who already knows (or previously knew) the password.
    if (!link.isActive) {
      return NextResponse.json({ error: 'This sharing link is no longer active', success: false }, { status: 403 });
    }

    let isValid = false;
    const originalHash = link.passwordHash;

    if (originalHash && SHA256_HEX.test(originalHash)) {
      // Legacy unsalted SHA-256 hash. Verify against the snapshot read
      // above, then transparently migrate the row to bcrypt.
      const legacyHash = createHash('sha256').update(password).digest('hex');
      isValid = legacyHash === originalHash;
      if (isValid) {
        const upgradedHash = await bcrypt.hash(password, 10);
        // Conditional write: only overwrite if the row still holds exactly
        // the hash we validated against. If the owner changed the password
        // concurrently (via POST /api/share) between our read and this
        // write, a blind update-by-id would silently revert their new
        // password to a bcrypt copy of the stale one. Matching zero rows
        // here just means "someone changed it, skip the upgrade" — this
        // request's verification already succeeded against what the caller
        // actually typed, so the response is unaffected either way.
        await prisma.sharedLink.updateMany({
          where: { id: link.id, passwordHash: originalHash },
          data: { passwordHash: upgradedHash }
        });
      }
    } else if (originalHash) {
      isValid = await bcrypt.compare(password, originalHash);
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
