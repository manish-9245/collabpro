import http from "http";
import https from "https";
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import dns from "dns";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { withErrorHandler } from "@/lib/api-middleware";
import { UploadService, UploadRepository, S3StorageService, LocalStorageService } from "@/lib/services/upload-service";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB limit

function isSafeIp(ip: string): boolean {
  if (!ip) return false;
  
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
}

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
    return isSafeIp(lookup.address);
  } catch (error) {
    return false;
  }
}

// Perform DNS rebinding safe HTTP/HTTPS request by binding directly to safe IP
async function safeFetch(urlStr: string): Promise<{ ok: boolean; statusText: string; headers: { get: (name: string) => string | null }; arrayBuffer: () => Promise<ArrayBuffer> }> {
  const urlObj = new URL(urlStr);
  const hostname = urlObj.hostname;
  
  const lookup = await dns.promises.lookup(hostname);
  const ip = lookup.address;
  
  if (!isSafeIp(ip)) {
    throw new Error("Restricted IP address resolved");
  }
  
  const protocol = urlObj.protocol;
  const port = urlObj.port || (protocol === "https:" ? "443" : "80");
  const pathWithQuery = urlObj.pathname + urlObj.search;
  
  return new Promise((resolve, reject) => {
    const options: any = {
      hostname: ip,
      port: port,
      path: pathWithQuery,
      method: "GET",
      headers: {
        "Host": hostname,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CollabPro-Uploader",
      }
    };
    
    const transport = protocol === "https:" ? https : http;
    if (protocol === "https:") {
      options.servername = hostname;
    }
    
    const req = transport.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => {
        chunks.push(chunk);
      });
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        const headersMap = new Map<string, string>();
        Object.entries(res.headers).forEach(([k, v]) => {
          if (typeof v === "string") {
            headersMap.set(k.toLowerCase(), v);
          } else if (Array.isArray(v)) {
            headersMap.set(k.toLowerCase(), v.join(", "));
          }
        });
        
        resolve({
          ok: (res.statusCode || 200) >= 200 && (res.statusCode || 200) < 300,
          statusText: res.statusMessage || "",
          headers: {
            get: (name: string) => headersMap.get(name.toLowerCase()) || null
          },
          arrayBuffer: async () => {
            return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
          }
        });
      });
    });
    
    req.on("error", (err) => {
      reject(err);
    });
    
    req.end();
  });
}

// Magic bytes validation for image headers (PNG, JPEG, GIF, WebP, SVG)
function isValidImageBuffer(buffer: Uint8Array): boolean {
  if (buffer.length < 4) return false;

  // SVG Check (text-based XML format)
  try {
    const headerText = new TextDecoder("utf-8").decode(buffer.slice(0, Math.min(buffer.length, 512)));
    const trimmedHeader = headerText.trim().toLowerCase();
    if (
      trimmedHeader.startsWith("<svg") ||
      trimmedHeader.includes("<svg") ||
      trimmedHeader.startsWith("<?xml") ||
      trimmedHeader.startsWith("<!doctype svg")
    ) {
      return true;
    }
  } catch (e) {
    // Ignore and proceed to binary magic bytes checks
  }

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

async function handlePost(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";
  let arrayBuffer: ArrayBuffer;
  let originalName = "image.png";
  let mimeType = "image/png";

  if (contentType.includes("application/json")) {
    const body = await request.json();
    const imageUrl = body.url;

    if (!imageUrl) {
      return NextResponse.json({ success: 0, message: "No image URL provided" }, { status: 400 });
    }

    // 1. SSRF URL validation
    const safe = await isSafeUrl(imageUrl);
    if (!safe) {
      logger.error(`[Upload API] Rejected unsafe URL (SSRF Prevention): ${imageUrl}`, null, { imageUrl });
      return NextResponse.json({ success: 0, message: "Invalid or restricted URL provided" }, { status: 400 });
    }

    logger.info(`[Upload API] Fetching image from URL: ${imageUrl}`, { imageUrl });
    
    // Perform HTTP request
    const res = await safeFetch(imageUrl);

    if (!res.ok) {
      return NextResponse.json({ success: 0, message: `Failed to fetch image from URL: ${res.statusText}` }, { status: 400 });
    }

    // Check content-type header of remote resource
    const remoteContentType = res.headers.get("content-type") || "";
    mimeType = remoteContentType || "application/octet-stream";

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
    const file = (formData.get("image") || formData.get("file")) as File | null;

    if (!file) {
      return NextResponse.json({ success: 0, message: "No file provided" }, { status: 400 });
    }

    // DoS: File size limit check
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: 0, message: "The file exceeds the maximum allowed limit of 10MB." }, { status: 400 });
    }

    arrayBuffer = await file.arrayBuffer();
    originalName = file.name;
    mimeType = file.type || "application/octet-stream";
  }

  // DoS: Check byteLength of array buffer in memory
  if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
    return NextResponse.json({ success: 0, message: "The file size exceeds the maximum allowed limit of 10MB." }, { status: 400 });
  }

  // Convert to typed Uint8Array
  const bufferArray = new Uint8Array(arrayBuffer);

  // Validate magic bytes
  if (!isValidImageBuffer(bufferArray)) {
    logger.error("[Upload API] Rejected file (failed image magic bytes validation)", null, { filename: originalName });
    return NextResponse.json({ success: 0, message: "Invalid or corrupted image file format." }, { status: 400 });
  }

  // SVG scripting check
  const isSvg = mimeType.toLowerCase().includes("svg") || originalName.toLowerCase().endsWith(".svg");
  if (isSvg) {
    const svgText = new TextDecoder("utf-8").decode(bufferArray);
    if (/<script/i.test(svgText)) {
      logger.error("[Upload API] Rejected SVG file containing script tag", null, { filename: originalName });
      return NextResponse.json({ success: 0, message: "Invalid or restricted SVG content: scripts are not allowed." }, { status: 400 });
    }
  }

  const sanitizedName = originalName.replace(/[^a-zA-Z0-9.-]/g, "_");

  // Inject dependencies dynamically using Dependency Inversion (SOLID Principle)
  const uploadRepo = new UploadRepository(prisma);
  const storageService = process.env.S3_ENDPOINT 
    ? new S3StorageService() 
    : new LocalStorageService();
  const uploadService = new UploadService(uploadRepo, storageService);

  logger.info(`[Upload API] Persisting file using injectable services: ${sanitizedName}`, { sanitizedName, mimeType });
  const uploadedRecord = await uploadService.handleUpload(sanitizedName, mimeType, bufferArray);

  // Return direct S3 URL if available for blazing-fast loading
  const returnedUrl = (process.env.S3_ENDPOINT && uploadedRecord.payload.startsWith("http"))
    ? uploadedRecord.payload
    : `/api/upload/${uploadedRecord.id}`;

  logger.info(`[Upload API] Image persisted successfully: id=${uploadedRecord.id}, url=${returnedUrl}`, { 
    id: uploadedRecord.id, 
    url: returnedUrl 
  });

  return NextResponse.json({
    success: 1,
    file: {
      url: returnedUrl,
    },
  });
}

export const POST = withErrorHandler(handlePost);
