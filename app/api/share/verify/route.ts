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

    // Rate limit, two gates that must both pass. Neither a link-only key nor
    // an IP-only key is sufficient alone: IP-only is trivially bypassed by
    // rotating x-forwarded-for (spoofable), while link-only lets one bad
    // actor's (or one fat-fingering visitor's) failed attempts lock out
    // every *other* legitimate visitor of that same public link for the
    // whole window.
    //
    // - Primary: per-(link, ip) compound bucket. Bounds attempts from one
    //   apparent source against one link. Rotating IP resets only the
    //   rotating attacker's own fresh bucket — it never touches other
    //   visitors' ability to verify against the same link.
    // - Secondary: per-link-only ceiling, deliberately much more generous.
    //   A backstop against a genuinely distributed brute force (many IPs
    //   against one link), set high enough that a handful of legitimate
    //   visitors occasionally mistyping never trips it.
    const ip = getClientIp(request);
    const [linkIpLimit, linkOnlyLimit] = await Promise.all([
      checkRateLimit(`share-verify:${link.id}:${ip}`, LIMITS.SHARE_VERIFY),
      checkRateLimit(`share-verify:link-total:${link.id}`, LIMITS.SHARE_VERIFY_PER_LINK),
    ]);
    if (!linkIpLimit.allowed || !linkOnlyLimit.allowed) {
      // Only the rejected bucket(s) should determine the retry delay - if
      // just one gate rejected, the other (still-allowed) bucket's later
      // resetAt shouldn't push out a retry that would actually succeed sooner.
      const rejectedResetAts = [
        ...(linkIpLimit.allowed ? [] : [linkIpLimit.resetAt]),
        ...(linkOnlyLimit.allowed ? [] : [linkOnlyLimit.resetAt]),
      ];
      const resetAt = Math.max(...rejectedResetAts);
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
