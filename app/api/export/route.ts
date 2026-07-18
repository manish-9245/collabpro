import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerSession } from "@/lib/session-auth/server";

function escapeAttr(val: any): string {
  return String(val || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET(request: Request) {
  const session = getServerSession();
  const sessionUser = await session.getUser();
  if (!sessionUser || !sessionUser.email) {
    return new NextResponse(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 150" width="400" height="150">
        <rect width="400" height="150" rx="16" fill="#fcf8f8" stroke="#fecaca" stroke-width="2" />
        <text x="20" y="55" font-family="sans-serif" font-size="14" font-weight="bold" fill="#991b1b">Unauthorized Access</text>
        <text x="20" y="85" font-family="sans-serif" font-size="11" fill="#7f1d1d">You must be logged in to export this workspace.</text>
      </svg>`,
      {
        status: 401,
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "no-store, max-age=0"
        }
      }
    );
  }
  const email = sessionUser.email;
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get("fileId");

  if (!fileId) {
    return new NextResponse(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 150" width="400" height="150">
        <rect width="400" height="150" rx="16" fill="#f8fafc" stroke="#e2e8f0" stroke-width="2" />
        <text x="20" y="55" font-family="sans-serif" font-size="14" font-weight="bold" fill="#0f172a">CollabPro Vector Export Error</text>
        <text x="20" y="85" font-family="sans-serif" font-size="11" fill="#64748b">Missing required 'fileId' query parameter.</text>
        <text x="20" y="110" font-family="sans-serif" font-size="9.5" font-weight="bold" fill="#6965db">Provide a valid board UUID to load elements.</text>
      </svg>`,
      {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "no-store, max-age=0"
        }
      }
    );
  }

  try {
    const file = await prisma.file.findUnique({
      where: { id: fileId }
    });

    if (!file) {
      return new NextResponse(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 150" width="400" height="150">
          <rect width="400" height="150" rx="16" fill="#fcf8f8" stroke="#fecaca" stroke-width="2" />
          <text x="20" y="55" font-family="sans-serif" font-size="14" font-weight="bold" fill="#991b1b">Workspace File Not Found</text>
          <text x="20" y="85" font-family="sans-serif" font-size="11" fill="#7f1d1d">The requested whiteboard document ID does not exist.</text>
          <text x="20" y="110" font-family="sans-serif" font-size="9.5" font-weight="bold" fill="#b91c1c">Check ID or team permissions.</text>
        </svg>`,
        {
          status: 404,
          headers: {
            "Content-Type": "image/svg+xml",
            "Cache-Control": "no-store, max-age=0"
          }
        }
      );
    }

    // Authorization check
    let hasAccess = file.createdBy === email;
    if (!hasAccess) {
      const membership = await prisma.teamMember.findFirst({
        where: {
          teamId: file.teamId,
          userEmail: email
        }
      });
      if (membership) {
        hasAccess = true;
      }
    }

    if (!hasAccess) {
      return new NextResponse(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 150" width="400" height="150">
          <rect width="400" height="150" rx="16" fill="#fcf8f8" stroke="#fecaca" stroke-width="2" />
          <text x="20" y="55" font-family="sans-serif" font-size="14" font-weight="bold" fill="#991b1b">Access Forbidden</text>
          <text x="20" y="85" font-family="sans-serif" font-size="11" fill="#7f1d1d">You do not have permission to view or export this whiteboard.</text>
        </svg>`,
        {
          status: 403,
          headers: {
            "Content-Type": "image/svg+xml",
            "Cache-Control": "no-store, max-age=0"
          }
        }
      );
    }

    let elements: any[] = [];
    if (file.whiteboard) {
      try {
        elements = JSON.parse(file.whiteboard);
      } catch (e) {
        console.error("Error parsing whiteboard elements:", e);
      }
    }

    // Filter active items and calculate dynamic bounds
    const activeElements = Array.isArray(elements) 
      ? elements.filter((el: any) => el && !el.isDeleted) 
      : [];

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    activeElements.forEach((el: any) => {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.width);
      maxY = Math.max(maxY, el.y + el.height);
    });

    if (minX === Infinity || activeElements.length === 0) {
      return new NextResponse(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 150" width="400" height="150">
          <rect width="400" height="150" rx="16" fill="#f8fafc" stroke="#e2e8f0" stroke-width="2" />
          <text x="20" y="55" font-family="sans-serif" font-size="14" font-weight="bold" fill="#0f172a">${file.fileName || "Empty Whiteboard"}</text>
          <text x="20" y="85" font-family="sans-serif" font-size="11" fill="#64748b">No active diagram elements drawn yet.</text>
          <text x="20" y="110" font-family="sans-serif" font-size="9.5" font-weight="bold" fill="#6965db">Ready for real-time visual collaboration!</text>
        </svg>`,
        {
          headers: {
            "Content-Type": "image/svg+xml",
            "Cache-Control": "public, max-age=10, s-maxage=10"
          }
        }
      );
    }

    // Apply auto-cropping bounds margin padding
    minX -= 40;
    minY -= 40;
    maxX += 40;
    maxY += 40;

    const width = maxX - minX;
    const height = maxY - minY;

    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}">\n`;
    svgContent += `  <!-- Background canvas grid overlay -->\n`;
    svgContent += `  <rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#fafafa" />\n`;

    activeElements.forEach((el: any) => {
      const stroke = escapeAttr(el.strokeColor || "#1e293b");
      const fill = el.backgroundColor === "transparent" ? "none" : escapeAttr(el.backgroundColor || "none");
      const strokeWidth = el.strokeWidth || 2;
      const opacity = el.opacity !== undefined ? el.opacity / 100 : 1;

      svgContent += `  <g opacity="${opacity}">\n`;

      if (el.type === "rectangle") {
        const rx = el.roundness ? 6 : 0;
        svgContent += `    <rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" rx="${rx}" ry="${rx}" />\n`;
      } else if (el.type === "ellipse") {
        const rx = el.width / 2;
        const ry = el.height / 2;
        const cx = el.x + rx;
        const cy = el.y + ry;
        svgContent += `    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />\n`;
      } else if (el.type === "text") {
        const fontSize = el.fontSize || 16;
        const fontFamily = el.fontFamily === 1 ? "sans-serif" : "monospace";
        // Clean text content to avoid XML breaking characters
        const textEscaped = String(el.text || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        svgContent += `    <text x="${el.x}" y="${el.y + fontSize}" fill="${stroke}" font-size="${fontSize}" font-family="${fontFamily}" font-weight="bold">${textEscaped}</text>\n`;
      } else if (el.type === "line" || el.type === "arrow") {
        if (el.points && el.points.length > 1) {
          let d = `M ${el.x + el.points[0][0]} ${el.y + el.points[0][1]}`;
          for (let i = 1; i < el.points.length; i++) {
            d += ` L ${el.x + el.points[i][0]} ${el.y + el.points[i][1]}`;
          }
          svgContent += `    <path d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />\n`;
        }
      } else if (el.type === "image") {
        svgContent += `    <rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" fill="#f1f5f9" stroke="${stroke}" stroke-width="1" stroke-dasharray="4,4" />\n`;
        svgContent += `    <text x="${el.x + 10}" y="${el.y + 20}" font-family="sans-serif" font-size="9" fill="#64748b">Locked image element</text>\n`;
      }

      svgContent += `  </g>\n`;
    });

    svgContent += `</svg>`;

    return new NextResponse(svgContent, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=60, s-maxage=60"
      }
    });

  } catch (error: any) {
    console.error("Error generating vector export:", error);
    return new NextResponse(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 150" width="400" height="150">
        <rect width="400" height="150" rx="16" fill="#fcf8f8" stroke="#fecaca" stroke-width="2" />
        <text x="20" y="55" font-family="sans-serif" font-size="14" font-weight="bold" fill="#991b1b">Server Exporter Crash</text>
        <text x="20" y="85" font-family="sans-serif" font-size="11" fill="#7f1d1d">An exception occurred inside the vector renderer.</text>
        <text x="20" y="110" font-family="sans-serif" font-size="9.5" font-weight="bold" fill="#b91c1c">${error.message || "Unknown execution error"}</text>
      </svg>`,
      {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "no-store, max-age=0"
        }
      }
    );
  }
}
