import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";
    let arrayBuffer: ArrayBuffer;
    let originalName = "image.png";

    if (contentType.includes("application/json")) {
      const body = await request.json();
      const imageUrl = body.url;

      if (!imageUrl) {
        return NextResponse.json({ success: 0, message: "No image URL provided" }, { status: 400 });
      }

      console.log(`[Upload API] Fetching image from URL: ${imageUrl}`);
      const res = await fetch(imageUrl);
      if (!res.ok) {
        return NextResponse.json({ success: 0, message: `Failed to fetch image from URL: ${res.statusText}` }, { status: 400 });
      }

      arrayBuffer = await res.arrayBuffer();
      
      try {
        const urlObj = new URL(imageUrl);
        const baseName = path.basename(urlObj.pathname);
        if (baseName && baseName.includes(".")) {
          originalName = baseName;
        }
      } catch (e) {
        // Fallback if URL is invalid or malformed
      }
    } else {
      const formData = await request.formData();
      const file = formData.get("image") as File | null;

      if (!file) {
        return NextResponse.json({ success: 0, message: "No file provided" }, { status: 400 });
      }

      arrayBuffer = await file.arrayBuffer();
      originalName = file.name;
    }

    // Ensure upload directory exists
    const uploadDir = path.join(process.cwd(), "public/uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Sanitize and generate unique filename
    const sanitizedName = originalName.replace(/[^a-zA-Z0-9.-]/g, "_");
    const filename = `${Date.now()}_${sanitizedName}`;
    const filePath = path.join(uploadDir, filename);

    // Save file locally
    fs.writeFileSync(filePath, new Uint8Array(arrayBuffer));

    const fileUrl = `/uploads/${filename}`;
    console.log(`[Upload API] Image saved successfully to ${filePath}`);

    return NextResponse.json({
      success: 1,
      file: {
        url: fileUrl,
      },
    });
  } catch (error: any) {
    console.error("[Upload API] Error saving file:", error);
    return NextResponse.json({ success: 0, message: error.message || "Upload failed" }, { status: 500 });
  }
}
