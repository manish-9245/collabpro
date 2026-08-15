/**
 * Fetches and translates items from the community Excalidraw icon libraries
 * (https://libraries.excalidraw.com, backed by the excalidraw/excalidraw-
 * libraries repo) so an MCP caller can drop a real AWS/Azure/GCP/network/UML
 * icon into a whiteboard without doing the fetch+translate+namespace dance
 * itself. Ported from that repo's own scripts/excalidraw_lib.py (MIT) -
 * same algorithm (namespace IDs, translate coordinates relative to the
 * item's own bounding box, fix up containerId/boundElements/bindings so
 * nothing dangles), reimplemented here since this server can't shell out to
 * a local Python script.
 *
 * Verified against a real item during manual testing: an AWS "EC2 Cluster"
 * icon (ellipse + 3 nested rectangles + text, all sharing one groupIds
 * entry) fetched, translated, and round-tripped through the real
 * collabpro_update_whiteboard tool and /api/export - see
 * lib/mcp/tools.ts's validateWhiteboardGeometry groupIds exemption, added
 * because of exactly this test.
 */

const LIBRARY_BASE = 'https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main';
const FETCH_TIMEOUT_MS = 5000;
// 3MB rejected real, popular libraries outright (e.g.
// childishgirl/aws-architecture-icons.excalidrawlib, 249 named items, is
// ~3.9MB - one of the largest in the whole 231-library catalog but a
// completely legitimate one). This is a fixed, hardcoded-host fetch (see
// isValidLibrarySource), not arbitrary user input, so the bound only needs
// to catch a genuinely pathological response, not defend against SSRF-style
// abuse - 8MB comfortably covers every real library with headroom to spare.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const CACHE_TTL_MS = 60 * 60 * 1000; // library content changes rarely

// Only ever fetches "<author>/<name>.excalidrawlib" appended to the fixed
// LIBRARY_BASE above - the caller can never supply a full URL or escape
// this path, so this can't become an SSRF vector to an arbitrary host.
const LIBRARY_SOURCE_RE = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\.excalidrawlib$/;

export function isValidLibrarySource(source: string): boolean {
  return LIBRARY_SOURCE_RE.test(source) && !source.includes('..');
}

const cache = new Map<string, { data: unknown; expiresAt: number }>();

async function fetchJsonCached(url: string): Promise<unknown> {
  const cached = cache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new Error(`Response from ${url} exceeds ${MAX_RESPONSE_BYTES} bytes`);
    const data = JSON.parse(text);
    cache.set(url, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export interface IconLibrarySummary {
  source: string;
  name: string;
  description: string;
  itemNames?: string[];
}

export async function searchIconLibraries(query: string): Promise<IconLibrarySummary[]> {
  const index = await fetchJsonCached(`${LIBRARY_BASE}/libraries.json`);
  const q = query.toLowerCase();
  const entries = Array.isArray(index) ? index : [];
  return entries
    .filter((lib: any) => {
      const haystack = `${lib.name || ''} ${lib.description || ''} ${(lib.itemNames || []).join(' ')}`.toLowerCase();
      return haystack.includes(q);
    })
    .slice(0, 20)
    .map((lib: any) => ({ source: lib.source, name: lib.name, description: lib.description, itemNames: lib.itemNames }));
}

type LibraryElement = Record<string, unknown>;

interface LibraryItem {
  name: string;
  elements: LibraryElement[];
}

// Same 3-tier fallback the whiteboard's own picker uses (Canvas.tsx's
// getItemName) - most real .excalidrawlib files have NO per-item name field
// at all (naming lives in the file's top-level itemNames array, positional
// and often entirely absent), so without this every item from most
// libraries came back as a useless "item0"/"item1"/... with no way for an
// MCP caller to know what it actually depicts.
function fallbackItemName(elements: LibraryElement[], index: number): string {
  const textEl = elements.find((e) => e.type === 'text');
  if (textEl && typeof textEl.text === 'string' && textEl.text.trim()) {
    return textEl.text.trim();
  }
  const types = Array.from(new Set(elements.map((e) => e.type).filter(Boolean)));
  if (types.length === 1) {
    const t = String(types[0]);
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return `Asset ${index + 1}`;
}

function itemsOf(lib: unknown): LibraryItem[] {
  const raw: unknown[] = (lib as any)?.libraryItems || (lib as any)?.library || [];
  const itemNames: unknown = (lib as any)?.itemNames;
  const names = Array.isArray(itemNames) ? itemNames : [];
  return raw.map((it, i) => {
    const elements = Array.isArray(it)
      ? (it as LibraryElement[])
      : (Array.isArray((it as any)?.elements) ? (it as any).elements : []);
    const name = (typeof names[i] === 'string' && names[i]) || fallbackItemName(elements, i);
    return { name, elements };
  });
}

/**
 * Namespaces IDs and translates every element by the item's own bounding
 * box (its min x/y across elements, not a full points/angle-aware bbox -
 * good enough to move the group as a rigid unit; ponytail: a precise bbox
 * would matter for the item's own footprint calculation, which nothing
 * here needs). Fixes up every reference (containerId, boundElements,
 * start/endBinding, groupIds) to the new namespaced IDs so nothing points
 * at a dangling original ID.
 */
function place(elements: LibraryElement[], tx: number, ty: number, prefix: string, scale: number): LibraryElement[] {
  const xs = elements.map((e) => (typeof e.x === 'number' ? e.x : 0));
  const ys = elements.map((e) => (typeof e.y === 'number' ? e.y : 0));
  const x0 = xs.length ? Math.min(...xs) : 0;
  const y0 = ys.length ? Math.min(...ys) : 0;

  const idMap = new Map<string, string>();
  for (const e of elements) {
    if (typeof e.id === 'string') idMap.set(e.id, `${prefix}_${e.id}`);
  }

  return elements.map((raw) => {
    const e: LibraryElement = { ...raw };
    if (typeof e.id === 'string') e.id = idMap.get(e.id) ?? e.id;
    if (typeof e.x === 'number') e.x = (e.x - x0) * scale + tx;
    if (typeof e.y === 'number') e.y = (e.y - y0) * scale + ty;
    if (typeof e.width === 'number') e.width = e.width * scale;
    if (typeof e.height === 'number') e.height = e.height * scale;
    if (Array.isArray(e.points)) {
      e.points = (e.points as [number, number][]).map(([px, py]) => [px * scale, py * scale]);
    }
    if (typeof e.fontSize === 'number') e.fontSize = e.fontSize * scale;
    if (typeof e.containerId === 'string' && idMap.has(e.containerId)) {
      e.containerId = idMap.get(e.containerId);
    }
    if (Array.isArray(e.boundElements)) {
      e.boundElements = (e.boundElements as any[]).map((be) =>
        be && typeof be === 'object' && idMap.has(be.id) ? { ...be, id: idMap.get(be.id) } : be
      );
    }
    for (const bindingKey of ['startBinding', 'endBinding'] as const) {
      const binding = e[bindingKey] as any;
      if (binding && typeof binding === 'object' && idMap.has(binding.elementId)) {
        e[bindingKey] = { ...binding, elementId: idMap.get(binding.elementId) };
      }
    }
    if (Array.isArray(e.groupIds)) {
      // Namespaced too, not just element IDs - otherwise two icons pulled
      // from libraries that happen to reuse a groupIds string would be
      // treated as one group by the overlap-exemption check in tools.ts.
      e.groupIds = (e.groupIds as unknown[]).map((g) => (typeof g === 'string' ? `${prefix}_${g}` : g));
    }
    return e;
  });
}

export interface LibraryItemSummary {
  index: number;
  name: string;
  elementCount: number;
  /** get_library_icon rejects image-element items outright - flagged here so a caller doesn't waste a call picking one. */
  hasImage: boolean;
}

// Enumerate every item in a library by name, so a caller can pick items
// deliberately instead of guessing numeric indices one fetch at a time -
// the practical way to actually get "all icons" out of a library through
// MCP rather than blindly trying index 0, 1, 2...
export async function listLibraryItems(librarySource: string): Promise<LibraryItemSummary[]> {
  if (!isValidLibrarySource(librarySource)) {
    throw new Error('librarySource must look like "author/name.excalidrawlib" (see collabpro_search_icon_libraries\'s "source" field)');
  }
  const lib = await fetchJsonCached(`${LIBRARY_BASE}/libraries/${librarySource}`);
  return itemsOf(lib).map((it, index) => ({
    index,
    name: it.name,
    elementCount: it.elements.length,
    hasImage: it.elements.some((e) => e.type === 'image'),
  }));
}

export interface LibraryIconResult {
  name: string;
  elements: LibraryElement[];
}

export async function getLibraryIcon(
  librarySource: string,
  item: string,
  targetX: number,
  targetY: number,
  idPrefix: string,
  scale: number
): Promise<LibraryIconResult> {
  if (!isValidLibrarySource(librarySource)) {
    throw new Error('librarySource must look like "author/name.excalidrawlib" (see collabpro_search_icon_libraries\'s "source" field)');
  }

  const lib = await fetchJsonCached(`${LIBRARY_BASE}/libraries/${librarySource}`);
  const items = itemsOf(lib);

  const resolved = /^\d+$/.test(item)
    ? items[Number(item)]
    : items.find((it) => it.name.toLowerCase().includes(item.toLowerCase()));

  if (!resolved) {
    throw new Error(`No item matching "${item}" in ${librarySource} (${items.length} item(s), 0-indexed if using a number).`);
  }
  if (resolved.elements.some((e) => e.type === 'image')) {
    throw new Error(`Item "${resolved.name}" contains an image element and won't render through this whiteboard field - pick a vector-only item.`);
  }

  return { name: resolved.name, elements: place(resolved.elements, targetX, targetY, idPrefix, scale) };
}
