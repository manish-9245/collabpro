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

// Bounded window scanned for the <svg> root element (issue #195 round 3). 512 bytes
// proved too small: a single legal leading XML comment or DOCTYPE (e.g. a generator
// attribution comment, a license header, or a full SVG 1.1 DTD reference) can easily
// push a legitimate <svg> root past that point, causing real, non-malicious SVGs to
// fail upload validation even though round 2's loop-based prolog parser handles them
// correctly once their bytes are actually in view. 4 KB comfortably covers realistic
// real-world prologs (long comments, multiple stacked processing instructions, a
// DOCTYPE with an internal subset) while remaining a small, cheap, bounded read
// relative to the 10 MB max upload size — decoding a few extra KB as UTF-8 is
// negligible, but decoding the *entire* buffer of every upload (including large,
// unrelated binary images that were never going to be SVGs) just to rule out SVG
// would add needless cost. A prolog beyond 4 KB is an accepted, deliberate limit: no
// known real-world SVG tooling produces one that large. See
// tests/unit/upload-svg-xss.test.ts for the tests documenting this tradeoff.
const HEADER_SCAN_BYTES = 4096;

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

    // Repeatedly strip legal XML prolog constructs — in any order and any number of
    // times — until nothing more can be stripped. A single fixed-order pass isn't
    // enough: a spec-legal SVG can have, e.g., an <?xml?> declaration followed by an
    // <?xml-stylesheet?> processing instruction (and/or comments, and/or a DOCTYPE)
    // before the <svg> root element ever appears.
    let previous: string;
    do {
      previous = text;

      // Any processing instruction, including the XML declaration itself: <?target ...?>
      text = text.replace(/^<\?[\s\S]*?\?>/, "").trim();

      // XML comment: <!-- ... -->
      text = text.replace(/^<!--[\s\S]*?-->/, "").trim();

      // DOCTYPE declaration, with or without an internal subset in [...]
      text = text.replace(/^<!doctype[^>[]*(\[[^\]]*\])?\s*>/i, "").trim();
    } while (text.length > 0 && text !== previous);

    const lower = text.toLowerCase();
    if (!lower.startsWith("<svg")) return false;

    // Require a proper element-name boundary right after "svg" (whitespace, '>', '/',
    // or end-of-scanned-content) so "<svgfoo>" isn't misclassified as an <svg> root —
    // it's a different, unrelated element name that merely starts with the same
    // characters.
    const boundary = lower.charAt(4);
    return boundary === "" || /[\s>/]/.test(boundary);
  } catch {
    return false;
  }
}
