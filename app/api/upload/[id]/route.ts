import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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

    // Detect SVGs by stored mime type (legacy rows may still say image/svg+xml) or filename,
    // since as of issue #195 newly uploaded SVGs are stored with mimeType overridden to
    // application/octet-stream and can no longer be identified by mimeType alone.
    const isSvg = uploadedFile.mimeType.toLowerCase().includes("svg") || uploadedFile.filename.toLowerCase().endsWith(".svg");

    // If the payload is an S3 / MinIO URL, redirect the client browser to load directly from
    // storage. Note: for SVGs the correct Content-Type/Content-Disposition are set at upload
    // time (see app/api/upload/route.ts and lib/s3.ts) since this redirect bypasses any
    // headers set below — the browser talks to S3 directly, not to this route.
    if (uploadedFile.payload.startsWith("http://") || uploadedFile.payload.startsWith("https://")) {
      return NextResponse.redirect(uploadedFile.payload, {
        headers: { "X-Content-Type-Options": "nosniff" },
      });
    }

    // Convert base64 payload back to Binary Buffer
    const buffer = Buffer.from(uploadedFile.payload, "base64");

    // Return image with the original content type. SVGs are never served as
    // image/svg+xml (which browsers render/execute inline) — they are forced to a
    // generic binary type with an attachment disposition so they always download
    // instead of executing (issue #195: SVG XSS via onload/onerror/javascript: URIs
    // that a <script>-tag substring check cannot fully catch).
    const headers: Record<string, string> = {
      "Content-Type": isSvg ? "application/octet-stream" : uploadedFile.mimeType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    };

    if (isSvg) {
      headers["Content-Security-Policy"] = "default-src 'none';";
      headers["Content-Disposition"] = "attachment; filename=\"" + uploadedFile.filename.replace(/"/g, "\\\"") + "\"";
    }

    return new NextResponse(buffer, {
      headers,
    });
  } catch (error: any) {
    console.error("[Get Uploaded File API] Error serving file:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
