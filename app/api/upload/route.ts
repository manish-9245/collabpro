import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import dns from "dns";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB limit
const ALLOWED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"];

// Helper to validate IP address for SSRF protection
async function isSafeUrl(urlStr: string): Promise<boolean> {
  try {
    const urlObj = new URL(urlStr);
    if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
      return false;
    }

    const hostname = urlObj.hostname;
    
    if (hostname.toLowerCase() === "localhost") {
      return false;
    }

    // Resolve hostname to IP address
    const lookup = await dns.promises.lookup(hostname);
    const ip = lookup.address;

    // Check loopback, link-local (AWS metadata), and empty IP
    if (
      ip.startsWith("127.") || 
      ip.startsWith("169.254.") || 
      ip === "0.0.0.0" || 
      ip === "::1" || 
      ip === "localhost"
    ) {
      return false;
    }

    // Check private IPv4 ranges
    const parts = ip.split(".").map(Number);
    if (parts.length === 4) {
      // Class A: 10.0.0.0/8
      if (parts[0] === 10) return false;
      // Class B: 172.16.0.0/12
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
      // Class C: 192.168.0.0/16
      if (parts[0] === 192 && parts[1] === 168) return false;
    }

    return true;
  } catch (error) {
    return false; // Reject if DNS lookup or parsing fails
  }
}

// Magic bytes validation for image headers (PNG, JPEG, GIF, WebP)
function isValidImageBuffer(buffer: Uint8Array): boolean {
  if (buffer.length < 12) return false;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return true;
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return true;
  }

  // GIF: GIF87a or GIF89a (47 49 46 38 37 61 / 47 49 46 38 39 61)
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return true;
  }

  // WebP: RIFF (first 4 bytes) + WEBP (bytes 8-11)
  if (
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50    // P
  ) {
    return true;
  }

  return false;
}

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

      // 1. SSRF URL validation
      const safe = await isSafeUrl(imageUrl);
      if (!safe) {
        console.error(`[Upload API] Rejected unsafe URL (SSRF Prevention): ${imageUrl}`);
        return NextResponse.json({ success: 0, message: "Invalid or restricted URL provided" }, { status: 400 });
      }

      console.log(`[Upload API] Fetching image from URL: ${imageUrl}`);
      
      // Perform HTTP request
      const res = await fetch(imageUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CollabPro-Uploader/1.0",
        },
      });

      if (!res.ok) {
        return NextResponse.json({ success: 0, message: `Failed to fetch image from URL: ${res.statusText}` }, { status: 400 });
      }

      // Check content-type header of remote resource
      const remoteContentType = res.headers.get("content-type") || "";
      const isAllowedMime = ALLOWED_MIME_TYPES.some(mime => remoteContentType.toLowerCase().startsWith(mime));
      if (!isAllowedMime) {
        return NextResponse.json({ success: 0, message: "Fetched URL does not point to an allowed image format." }, { status: 400 });
      }

      // DoS: Pre-check content-length header
      const contentLengthHeader = res.headers.get("content-length");
      if (contentLengthHeader) {
        const sizeBytes = parseInt(contentLengthHeader, 10);
        if (sizeBytes > MAX_FILE_SIZE) {
          return NextResponse.json({ success: 0, message: "The remote file exceeds the maximum allowed limit of 10MB." }, { status: 400 });
        }
      }

      arrayBuffer = await res.arrayBuffer();
      
      try {
        const urlObj = new URL(imageUrl);
        const baseName = path.basename(urlObj.pathname);
        if (baseName && baseName.includes(".")) {
          originalName = baseName;
        }
      } catch (e) {
        // Fallback
      }
    } else {
      const formData = await request.formData();
      const file = formData.get("image") as File | null;

      if (!file) {
        return NextResponse.json({ success: 0, message: "No file provided" }, { status: 400 });
      }

      // DoS: File size limit check
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json({ success: 0, message: "The file exceeds the maximum allowed limit of 10MB." }, { status: 400 });
      }

      // MIME type check
      if (!ALLOWED_MIME_TYPES.includes(file.type.toLowerCase())) {
        return NextResponse.json({ success: 0, message: "Invalid file type. Only standard images (PNG, JPEG, GIF, WebP) are allowed." }, { status: 400 });
      }

      arrayBuffer = await file.arrayBuffer();
      originalName = file.name;
    }

    // DoS: Check byteLength of array buffer in memory
    if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
      return NextResponse.json({ success: 0, message: "The file size exceeds the maximum allowed limit of 10MB." }, { status: 400 });
    }

    // Extension validation
    const extension = path.extname(originalName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      return NextResponse.json({ success: 0, message: "Invalid file extension. Only standard images are allowed." }, { status: 400 });
    }

    // Convert to typed Uint8Array
    const bufferArray = new Uint8Array(arrayBuffer);

    // Magic number verification to prevent stored-content attack vectors (XSS / SVGs disguised as PNGs etc)
    if (!isValidImageBuffer(bufferArray)) {
      return NextResponse.json({ success: 0, message: "Content verification failed. File is not a valid image format." }, { status: 400 });
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
    fs.writeFileSync(filePath, bufferArray);

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
