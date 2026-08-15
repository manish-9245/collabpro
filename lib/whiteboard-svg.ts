/**
 * Renders Excalidraw-compatible whiteboard elements to a standalone SVG
 * string. Extracted from app/api/export/route.ts (issue: live embeds) so
 * the same renderer can back both the session-authed export route and the
 * public share-token-gated embed route, instead of drifting into two
 * separately-maintained copies.
 */

function escapeAttr(val: any): string {
  return String(val || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeText(val: any): string {
  return String(val || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function svgMessage(opts: { title: string; body: string; footer?: string; tone?: "error" | "neutral" }): string {
  const tone = opts.tone === "error"
    ? { bg: "#fcf8f8", border: "#fecaca", title: "#991b1b", body: "#7f1d1d" }
    : { bg: "#f8fafc", border: "#e2e8f0", title: "#0f172a", body: "#64748b" };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 150" width="400" height="150">
    <rect width="400" height="150" rx="16" fill="${tone.bg}" stroke="${tone.border}" stroke-width="2" />
    <text x="20" y="55" font-family="sans-serif" font-size="14" font-weight="bold" fill="${tone.title}">${escapeText(opts.title)}</text>
    <text x="20" y="85" font-family="sans-serif" font-size="11" fill="${tone.body}">${escapeText(opts.body)}</text>
    ${opts.footer ? `<text x="20" y="110" font-family="sans-serif" font-size="9.5" font-weight="bold" fill="#6965db">${escapeText(opts.footer)}</text>` : ""}
  </svg>`;
}

/**
 * Parses a File.whiteboard column value (JSON string, either a bare
 * elements array or the current { elements, files } shape) into a plain
 * elements array - same unwrap asWhiteboardElements()/casUpdateWhiteboard's
 * callers apply elsewhere, or every current-format file renders as empty.
 */
export function parseWhiteboardElements(whiteboard: string | null | undefined): any[] {
  if (!whiteboard) return [];
  try {
    const parsed = JSON.parse(whiteboard);
    return Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.elements) ? parsed.elements : []);
  } catch {
    return [];
  }
}

export function renderWhiteboardSvg(elements: any[], fileName?: string): string {
  const activeElements = Array.isArray(elements) ? elements.filter((el: any) => el && !el.isDeleted) : [];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  activeElements.forEach((el: any) => {
    // Arrow/line elements are positioned by `points` relative to x/y and
    // don't necessarily carry a meaningful width/height - treat a missing
    // one as 0 rather than letting `el.x + undefined` produce NaN, which
    // (since Math.min/max(n, NaN) is always NaN) would otherwise blank out
    // the bounding box for every element once any single one is affected.
    const width = Number.isFinite(el.width) ? el.width : 0;
    const height = Number.isFinite(el.height) ? el.height : 0;
    if (!Number.isFinite(el.x) || !Number.isFinite(el.y)) return;
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + width);
    maxY = Math.max(maxY, el.y + height);
  });

  if (minX === Infinity || activeElements.length === 0) {
    return svgMessage({
      title: fileName || "Empty Whiteboard",
      body: "No active diagram elements drawn yet.",
      footer: "Ready for real-time visual collaboration!",
    });
  }

  minX -= 40; minY -= 40; maxX += 40; maxY += 40;
  const width = maxX - minX;
  const height = maxY - minY;

  let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}">\n`;
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
      svgContent += `    <text x="${el.x}" y="${el.y + fontSize}" fill="${stroke}" font-size="${fontSize}" font-family="${fontFamily}" font-weight="bold">${escapeText(el.text)}</text>\n`;
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
  return svgContent;
}
