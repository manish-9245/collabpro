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

    // If the payload is an S3 / MinIO URL, redirect the client browser to load directly from storage
    if (uploadedFile.payload.startsWith("http://") || uploadedFile.payload.startsWith("https://")) {
      return NextResponse.redirect(uploadedFile.payload);
    }

    // Convert base64 payload back to Binary Buffer
    const buffer = Buffer.from(uploadedFile.payload, "base64");

    // Return image with the original content type
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": uploadedFile.mimeType,
        "Cache-Control": "public, max-age=31536000, immutable", // Extremely fast cache
      },
    });
  } catch (error: any) {
    console.error("[Get Uploaded File API] Error serving file:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
