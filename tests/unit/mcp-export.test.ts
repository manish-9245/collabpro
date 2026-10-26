import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { documentToHtml, documentToMarkdown, documentToText, exportFile, MAX_EXPORT_CHARS } from '@/lib/mcp/export';

// Reproduces the pre-#188 { yjs: true, data } envelope (same helper as legacy-crdt-decode.test.ts).
function legacyEncode(state: Record<string, unknown>): string {
  const ydoc = new Y.Doc();
  const setDeep = (target: Y.Map<unknown>, obj: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined || value === null) target.set(key, null);
      else if (Array.isArray(value)) {
        const arr = new Y.Array<unknown>();
        target.set(key, arr);
        arr.insert(0, value.map((item) => {
          if (item && typeof item === 'object') { const m = new Y.Map<unknown>(); setDeep(m, item as Record<string, unknown>); return m; }
          return item;
        }));
      } else if (typeof value === 'object') {
        const m = new Y.Map<unknown>();
        target.set(key, m);
        setDeep(m, value as Record<string, unknown>);
      } else target.set(key, value);
    }
  };
  setDeep(ydoc.getMap('state'), state);
  return JSON.stringify({ yjs: true, data: Buffer.from(Y.encodeStateAsUpdate(ydoc)).toString('base64') });
}

const doc = JSON.stringify({
  blocks: [
    { type: 'header', data: { text: 'Plan', level: 2 } },
    { type: 'paragraph', data: { text: 'Hello <b>world</b> &amp; <script>x</script>' } },
    { type: 'list', data: { style: 'ordered', items: ['one', 'two'] } },
    { type: 'checklist', data: { items: [{ text: 'done', checked: true }, { text: 'todo', checked: false }] } },
    { type: 'table', data: { content: [['a', 'b'], ['1', '2']] } },
    { type: 'image', data: { file: { url: 'https://cdn.example.com/x.png' }, caption: 'Fig' } },
    { type: 'warning', data: { title: 'Heads up', message: 'Mind <script>x</script> this' } },
  ],
});

describe('document export', () => {
  it('renders markdown', () => {
    const md = documentToMarkdown(doc, 'My File');
    expect(md).toContain('# My File');
    expect(md).toContain('## Plan');
    expect(md).toContain('1. one');
    expect(md).toContain('- [x] done');
    expect(md).toContain('| a | b |');
    expect(md).toContain('![Fig](https://cdn.example.com/x.png)');
    expect(md).toContain('> **Heads up** Mind x this');
  });
  it('escapes everything in html (no script injection)', () => {
    const html = documentToHtml(doc, '<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('Hello world &amp; x');
    expect(html).toContain('<img src="https://cdn.example.com/x.png"');
  });
  it('html keeps warning blocks (escaped)', () => {
    const html = documentToHtml(doc, 't');
    expect(html).toContain('<blockquote><strong>Heads up</strong> Mind x this</blockquote>');
  });
  it('text export includes checklist items, list items, tables and warnings', () => {
    const text = documentToText(doc);
    expect(text).toContain('done');
    expect(text).toContain('todo');
    expect(text).toContain('one');
    expect(text).toContain('a | b');
    expect(text).toContain('Heads up');
  });
  it('decodes REAL legacy Yjs-encoded state: the exported content is the original content, not an empty file', () => {
    const legacyDoc = legacyEncode({ blocks: [{ type: 'paragraph', data: { text: 'Legacy hello' } }, { type: 'header', data: { text: 'Legacy title', level: 2 } }] });
    const legacyBoard = legacyEncode({ elements: [{ id: 'r', type: 'rectangle', x: 0, y: 0, width: 30, height: 30, strokeColor: '#123456' }], files: {} });
    const md = exportFile({ fileName: 'f', document: legacyDoc, whiteboard: legacyBoard }, 'markdown').content;
    expect(md).toContain('Legacy hello');
    expect(md).toContain('## Legacy title');
    expect(exportFile({ fileName: 'f', document: legacyDoc, whiteboard: legacyBoard }, 'text').content).toContain('Legacy hello');
    expect(exportFile({ fileName: 'f', document: legacyDoc, whiteboard: legacyBoard }, 'svg').content).toContain('#123456');
  });
  it('keeps text containing an unmatched "<" instead of truncating it', () => {
    const d = JSON.stringify({ blocks: [{ type: 'paragraph', data: { text: 'if 2 < 3 then <b>ok</b> and a<b' } }] });
    const md = documentToMarkdown(d, 't');
    expect(md).toContain('if 2 < 3 then ok and a<b');
  });
  it('tag stripping is linear on hostile input (no regex backtracking)', () => {
    const hostile = JSON.stringify({ blocks: [{ type: 'paragraph', data: { text: '<'.repeat(200_000) } }] });
    const t0 = Date.now();
    documentToMarkdown(hostile, 't');
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it('drops non-http image URLs', () => {
    const bad = JSON.stringify({ blocks: [{ type: 'image', data: { file: { url: 'javascript:alert(1)' } } }] });
    expect(documentToHtml(bad, 't')).not.toContain('javascript:');
  });
  it('tolerates empty/invalid documents and truncates huge output', () => {
    expect(documentToMarkdown('', 'T')).toBe('# T\n');
    const big = JSON.stringify({ blocks: [{ type: 'paragraph', data: { text: 'x'.repeat(MAX_EXPORT_CHARS + 10) } }] });
    const out = exportFile({ fileName: 'f', document: big, whiteboard: '' }, 'markdown');
    expect(out.truncated).toBe(true);
    expect(out.content.length).toBe(MAX_EXPORT_CHARS);
  });
  it('renders svg for the whiteboard', () => {
    const wb = JSON.stringify([{ id: 'r', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, strokeColor: '#000' }]);
    const svg = exportFile({ fileName: 'f', document: '', whiteboard: wb }, 'svg').content;
    expect(svg).toContain('<svg');
    expect(svg).toMatch(/<rect[^>]*stroke="#000(000)?"/); // the supplied rectangle itself is rendered, not a generic empty fallback
  });
});
