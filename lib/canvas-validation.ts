/**
 * Validate and sanitize whiteboard elements to ensure correct coordinate metrics, dimensions,
 * and prevent Denial of Service (DoS) attacks from bloated freehand drawing trails.
 */
export function validateAndSanitizeWhiteboardElements(elements: any[]): any[] {
  if (!Array.isArray(elements)) {
    throw new Error("Invalid whiteboard payload. Expected an array of elements.");
  }

  // Cap total elements in a single sync to prevent memory / CPU exhaustion (DoS)
  const MAX_ELEMENTS = 5000;
  if (elements.length > MAX_ELEMENTS) {
    throw new Error(`Whiteboard update exceeds the maximum allowed elements limit (${MAX_ELEMENTS}).`);
  }

  const validElements: any[] = [];

  for (const elem of elements) {
    if (!elem || typeof elem !== 'object') continue;

    // Must have id and type
    if (typeof elem.id !== 'string' || !elem.id.trim()) continue;
    if (typeof elem.type !== 'string' || !elem.type.trim()) continue;

    // Validate Coordinates
    const x = Number(elem.x);
    const y = Number(elem.y);
    if (isNaN(x) || !isFinite(x) || isNaN(y) || !isFinite(y)) {
      throw new Error(`Element ${elem.id} has invalid coordinates.`);
    }

    // Validate Height/Width Metrics (reject negative metrics)
    const width = Number(elem.width);
    const height = Number(elem.height);
    if (isNaN(width) || !isFinite(width) || width < 0 || isNaN(height) || !isFinite(height) || height < 0) {
      throw new Error(`Element ${elem.id} has invalid or negative dimensions.`);
    }

    // Validate and cap point coordinate arrays (e.g. for freehand drawing trails)
    let points = elem.points;
    if (Array.isArray(points)) {
      const MAX_POINTS = 1000;
      if (points.length > MAX_POINTS) {
        // Cap the points array to prevent Denial of Service (big payload throttling)
        points = points.slice(0, MAX_POINTS);
      }
      
      // Ensure all points are valid coordinate arrays [number, number]
      for (const pt of points) {
        if (!Array.isArray(pt) || pt.length < 2 || typeof pt[0] !== 'number' || typeof pt[1] !== 'number') {
          throw new Error(`Element ${elem.id} contains invalid point coordinates.`);
        }
      }
    }

    validElements.push({
      ...elem,
      x,
      y,
      width,
      height,
      ...(points ? { points } : {}),
    });
  }

  return validElements;
}
