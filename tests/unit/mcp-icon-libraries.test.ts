import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidLibrarySource, searchIconLibraries, listLibraryItems, getLibraryIcon } from '@/lib/mcp/icon-libraries';

const mockFetch = vi.fn();

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, text: async () => JSON.stringify(body) };
}

describe('lib/mcp/icon-libraries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  describe('isValidLibrarySource', () => {
    it('accepts a well-formed author/name.excalidrawlib source', () => {
      expect(isValidLibrarySource('husainkhambaty/aws-simple-icons.excalidrawlib')).toBe(true);
    });

    it('rejects a source that is not the expected shape (SSRF guard)', () => {
      expect(isValidLibrarySource('https://evil.example.com/x.excalidrawlib')).toBe(false);
      expect(isValidLibrarySource('../../etc/passwd')).toBe(false);
      expect(isValidLibrarySource('author/name.json')).toBe(false);
      expect(isValidLibrarySource('author/../../name.excalidrawlib')).toBe(false);
    });
  });

  describe('searchIconLibraries', () => {
    it('matches on name, description, and item names, and only fetches the fixed trusted index URL', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([
        { source: 'a/aws.excalidrawlib', name: 'AWS Icons', description: 'AWS stuff', itemNames: ['Lambda'] },
        { source: 'b/network.excalidrawlib', name: 'Network', description: 'Routers etc', itemNames: [] },
      ]));

      const results = await searchIconLibraries('aws');
      expect(results).toHaveLength(1);
      expect(results[0].source).toBe('a/aws.excalidrawlib');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries.json',
        expect.anything()
      );
    });
  });

  describe('getLibraryIcon', () => {
    const fakeLibrary = {
      libraryItems: [
        [
          { id: 'bg', type: 'ellipse', x: 100, y: 200, width: 50, height: 50, groupIds: ['icon1'], boundElements: [{ id: 'lbl', type: 'text' }] },
          { id: 'part', type: 'rectangle', x: 110, y: 210, width: 10, height: 10, groupIds: ['icon1'] },
          { id: 'lbl', type: 'text', x: 105, y: 260, width: 30, height: 10, text: 'EC2', containerId: 'bg' },
        ],
      ],
    };

    it('rejects a librarySource that fails validation before ever calling fetch', async () => {
      await expect(getLibraryIcon('not-a-valid-source', '0', 0, 0, 'p', 1)).rejects.toThrow(/author\/name/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('translates coordinates relative to the item bbox and namespaces every ID reference', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(fakeLibrary));

      // No top-level itemNames on fakeLibrary, so this falls back to the
      // item's own bound text element ("EC2") - see fallbackItemName.
      const { name, elements } = await getLibraryIcon('author/lib.excalidrawlib', '0', 500, 500, 'myicon', 1);
      expect(name).toBe('EC2');
      expect(elements).toHaveLength(3);

      const bg = elements.find((e: any) => e.id === 'myicon_bg') as any;
      const part = elements.find((e: any) => e.id === 'myicon_part') as any;
      const lbl = elements.find((e: any) => e.id === 'myicon_lbl') as any;

      // bbox min was (100, 200); translated to (500, 500).
      expect(bg.x).toBe(500);
      expect(bg.y).toBe(500);
      expect(part.x).toBe(510); // 110 - 100 + 500
      expect(part.y).toBe(510);

      // groupIds namespaced too, not just element IDs.
      expect(bg.groupIds).toEqual(['myicon_icon1']);
      expect(part.groupIds).toEqual(['myicon_icon1']);

      // containerId and boundElements[].id rewritten to the namespaced ID.
      expect(lbl.containerId).toBe('myicon_bg');
      expect(bg.boundElements).toEqual([{ id: 'myicon_lbl', type: 'text' }]);
    });

    it('resolves an item by 0-based index or by case-insensitive name substring', async () => {
      // Each getLibraryIcon call below uses a distinct librarySource so the
      // module-level response cache (keyed by URL, shared across this whole
      // test file) can't serve one call's queued mock to a different call.
      // Real .excalidrawlib files name items via a top-level itemNames
      // array (positional), not a per-item name field - matches what the
      // in-app picker (Canvas.tsx's getItemName) actually reads.
      const namedLibrary = { itemNames: ['Lambda Function'], library: [{ elements: [{ id: 'x', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }] }] };

      mockFetch.mockResolvedValueOnce(jsonResponse(namedLibrary));
      const byIndex = await getLibraryIcon('by-index/lib.excalidrawlib', '0', 0, 0, 'p', 1);
      expect(byIndex.name).toBe('Lambda Function');

      mockFetch.mockResolvedValueOnce(jsonResponse(namedLibrary));
      const byName = await getLibraryIcon('by-name/lib.excalidrawlib', 'lambda', 0, 0, 'p', 1);
      expect(byName.name).toBe('Lambda Function');
    });

    it('rejects an item containing an image element - it would not render through this whiteboard field', async () => {
      const imageLibrary = { libraryItems: [[{ id: 'x', type: 'image', x: 0, y: 0, width: 10, height: 10 }]] };
      mockFetch.mockResolvedValueOnce(jsonResponse(imageLibrary));
      await expect(getLibraryIcon('has-image/lib.excalidrawlib', '0', 0, 0, 'p', 1)).rejects.toThrow(/image element/);
    });

    it('rejects an out-of-range item selector with a helpful message', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(fakeLibrary));
      await expect(getLibraryIcon('out-of-range/lib.excalidrawlib', '99', 0, 0, 'p', 1)).rejects.toThrow(/No item matching/);
    });
  });

  describe('listLibraryItems', () => {
    it('names each item via itemNames first, then a bound text label, then its element type, then a numbered fallback', async () => {
      const mixedLibrary = {
        itemNames: ['VPC', undefined, '', undefined],
        libraryItems: [
          [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }], // itemNames[0] = 'VPC' wins
          [{ id: 'b', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'S3 Bucket' }], // no itemNames[1] -> text label
          [ // no itemNames[2] (empty string, falsy) and no text -> homogeneous type
            { id: 'c1', type: 'ellipse', x: 0, y: 0, width: 10, height: 10 },
            { id: 'c2', type: 'ellipse', x: 5, y: 5, width: 10, height: 10 },
          ],
          [ // no name anywhere, mixed types -> numbered fallback
            { id: 'd1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
            { id: 'd2', type: 'diamond', x: 5, y: 5, width: 10, height: 10 },
          ],
        ],
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(mixedLibrary));

      const items = await listLibraryItems('mixed/lib.excalidrawlib');
      expect(items).toEqual([
        { index: 0, name: 'VPC', elementCount: 1, hasImage: false },
        { index: 1, name: 'S3 Bucket', elementCount: 1, hasImage: false },
        { index: 2, name: 'Ellipse', elementCount: 2, hasImage: false },
        { index: 3, name: 'Asset 4', elementCount: 2, hasImage: false },
      ]);
    });

    it('flags items containing an image element, so a caller knows get_library_icon would reject them', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ libraryItems: [[{ id: 'x', type: 'image', x: 0, y: 0, width: 10, height: 10 }]] }));
      const items = await listLibraryItems('has-image/lib.excalidrawlib');
      expect(items).toEqual([{ index: 0, name: 'Image', elementCount: 1, hasImage: true }]);
    });

    it('rejects a librarySource that fails validation before ever calling fetch', async () => {
      await expect(listLibraryItems('not-a-valid-source')).rejects.toThrow(/author\/name/);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
