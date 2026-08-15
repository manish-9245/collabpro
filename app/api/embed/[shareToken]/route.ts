import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { renderWhiteboardSvg, parseWhiteboardElements, svgMessage } from "@/lib/whiteboard-svg";

/**
 * Public, unauthenticated SVG embed of a whiteboard's CURRENT state - the
 * one URL shape that actually works dropped into a GitHub README as
 * `![diagram](.../api/embed/<shareToken>)`: GitHub's own image proxy fetches
 * it server-side with no cookies, so this can never sit behind session auth
 * the way /api/export does.
 *
 * Gated by the same SharedLink token the existing "Share" viewer link uses
 * (app/api/share/route.ts), not a bare fileId - a raw fileId is a UUID an
 * owner never treated as secret, so keying public access off it directly
 * would make every file's diagram embeddable by anyone who could guess or
 * observe one ID. Respects the share link's own active/expiry state, and
 * explicitly refuses a password-protected link (an <img> tag has no way to
 * prompt for one, so silently ignoring the password would defeat it).
 *
 * No session check at all - that's the point of this route.
 */
export async function GET(request: Request, { params }: { params: Promise<{ shareToken: string }> }) {
  const { shareToken } = await params;

  try {
    const link = await prisma.sharedLink.findUnique({ where: { id: shareToken } });

    if (!link || !link.isActive) {
      return new NextResponse(
        svgMessage({ title: "Embed Unavailable", body: "This share link doesn't exist or has been deactivated.", tone: "error" }),
        { status: 404, headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store, max-age=0" } }
      );
    }
    if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
      return new NextResponse(
        svgMessage({ title: "Embed Expired", body: "This share link has expired - generate a new one to keep embedding.", tone: "error" }),
        { status: 410, headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store, max-age=0" } }
      );
    }
    if (link.passwordHash) {
      return new NextResponse(
        svgMessage({ title: "Embed Unavailable", body: "Password-protected share links can't be embedded - a static image has no way to prompt for the password.", footer: "Create a link without a password to embed this diagram." }),
        { status: 403, headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const file = await prisma.file.findUnique({ where: { id: link.fileId } });
    if (!file) {
      return new NextResponse(
        svgMessage({ title: "Embed Unavailable", body: "The workspace this link pointed to no longer exists.", tone: "error" }),
        { status: 404, headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const elements = parseWhiteboardElements(file.whiteboard);
    const svgContent = renderWhiteboardSvg(elements, file.fileName);

    return new NextResponse(svgContent, {
      headers: {
        "Content-Type": "image/svg+xml",
        // Short-lived, not no-store: this is meant to look "live" when the
        // canvas changes, but a fixed image fetched dozens of times a
        // second by e.g. a CI badge check shouldn't hit the DB every time.
        // GitHub's own camo proxy caches on top of this regardless - out of
        // this app's control, but the origin always serves the freshest
        // state within this window.
        "Cache-Control": "public, max-age=30, s-maxage=30",
      }
    });
  } catch (error: any) {
    console.error("Error generating embed SVG:", error);
    return new NextResponse(
      svgMessage({ title: "Server Exporter Crash", body: "An exception occurred inside the vector renderer.", footer: error.message || "Unknown execution error", tone: "error" }),
      { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
