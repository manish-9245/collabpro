/**
 * Content-based SVG detection (issue #195 follow-up).
 *
 * Client-supplied filename and Content-Type/mimetype are attacker-controlled and must
 * never be trusted to decide whether a file gets "safe SVG" treatment (forced
 * application/octet-stream + attachment disposition). A file can be uploaded with real
 * SVG bytes (including `<svg onload="...">`-style payloads) while being named
 * "evil.png"/"evil.html" and sent with an unrelated Content-Type header — the only
 * trustworthy signal is the actual bytes of the file. This module is the single source
 * of truth for "is this buffer SVG content", and must be used everywhere that decision
 * is made: initial validation, storage mimeType/disposition, and serving.
 */

const HEADER_SCAN_BYTES = 512;

/**
 * Returns true only if the buffer's root XML element is <svg>. A bare XML declaration
 * (<?xml ...?>) is not sufficient on its own — plenty of legitimate, non-SVG XML
 * documents start that way, and treating any such document as SVG would both
 * misclassify non-images as valid uploads and apply irrelevant SVG-only handling to
 * them.
 */
export function isSvgContent(buffer: Uint8Array): boolean {
  try {
    const headerText = new TextDecoder("utf-8").decode(
      buffer.slice(0, Math.min(buffer.length, HEADER_SCAN_BYTES))
    );

    let text = headerText.replace(/^\uFEFF/, "").trim();

    // Strip a single leading XML declaration: <?xml version="1.0" ...?>
    text = text.replace(/^<\?xml[^>]*\?>/i, "").trim();

    // Strip any leading XML comments: <!-- ... -->
    while (/^<!--/.test(text)) {
      const end = text.indexOf("-->");
      if (end === -1) break;
      text = text.slice(end + 3).trim();
    }

    // Strip a leading DOCTYPE declaration, with or without an internal subset in [...]
    text = text.replace(/^<!doctype[^>[]*(\[[^\]]*\])?\s*>/i, "").trim();

    return text.toLowerCase().startsWith("<svg");
  } catch {
    return false;
  }
}
