import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isSvgContent } from "@/lib/security/svg-content";

function svgResponseHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type": "application/octet-stream",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none';",
    "Content-Disposition": "attachment; filename=\"" + filename.replace(/"/g, "\\\"") + "\"",
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const fileId = resolvedParams?.id;

    if (!fileId) {
      return new NextResponse("File ID required", { status: 400 });
    }

    const uploadedFile = await prisma.uploadedFile.findUnique({
      where: { id: fileId },
    });

    if (!uploadedFile) {
      return new NextResponse("File not found", { status: 404 });
    }

    // If the payload is an S3 / MinIO URL, we normally redirect the browser to load
    // directly from storage for performance. As of issue #195's fix, every SVG upload
    // has its safe Content-Type/Content-Disposition metadata written directly onto the
    // S3 object at upload time (see app/api/upload/route.ts and lib/s3.ts) — since a
    // redirect's own headers are not what the browser ultimately receives (it gets
    // S3's response headers after following the redirect), that metadata has to live
    // on the object itself, and for new uploads it does.
    //
    // Records created *before* that fix may still be stored on S3 with unsafe metadata
    // (Content-Type: image/svg+xml, no attachment disposition) — we can't safely
    // inspect their bytes without fetching them, so as a heuristic, anything whose
    // stored mimeType/filename look SVG-ish is treated as "possibly legacy-unsafe" and
    // proxied through this route (fetched server-side, then re-served with forced-safe
    // headers) instead of redirected. This does not close every historical gap (e.g. a
    // pre-fix S3 upload where the bypass in app/api/upload/route.ts was additionally
    // used to mislabel real SVG content as, say, "evil.png" before it was stored) —
    // that residual, non-SVG-labeled legacy data cannot be distinguished from any other
    // legacy binary upload without re-fetching and content-sniffing every S3 redirect,
    // which would defeat the purpose of redirecting at all. New uploads are fully safe
    // because classification now happens once, from validated content, at write time.
    if (uploadedFile.payload.startsWith("http://") || uploadedFile.payload.startsWith("https://")) {
      const looksLegacySvg =
        uploadedFile.mimeType.toLowerCase().includes("svg") || uploadedFile.filename.toLowerCase().endsWith(".svg");

      if (looksLegacySvg) {
        const s3Response = await fetch(uploadedFile.payload);
        if (!s3Response.ok) {
          return new NextResponse("File not found", { status: 404 });
        }
        const s3ArrayBuffer = await s3Response.arrayBuffer();
        return new NextResponse(Buffer.from(s3ArrayBuffer), {
          headers: svgResponseHeaders(uploadedFile.filename),
        });
      }

      return NextResponse.redirect(uploadedFile.payload, {
        headers: { "X-Content-Type-Options": "nosniff" },
      });
    }

    // Convert base64 payload back to Binary Buffer
    const buffer = Buffer.from(uploadedFile.payload, "base64");

    // Classify SVG from the actual stored bytes, not from mimeType/filename — this is
    // the same content-based check used at upload time, so it also retroactively
    // protects any locally-stored record from before issue #195's fix, regardless of
    // what mimeType/filename was recorded for it back then.
    const isSvg = isSvgContent(buffer);

    if (isSvg) {
      return new NextResponse(buffer, { headers: svgResponseHeaders(uploadedFile.filename) });
    }

    // Return image with its original content type.
    const headers: Record<string, string> = {
      "Content-Type": uploadedFile.mimeType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    };

    return new NextResponse(buffer, {
      headers,
    });
  } catch (error: any) {
    console.error("[Get Uploaded File API] Error serving file:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
