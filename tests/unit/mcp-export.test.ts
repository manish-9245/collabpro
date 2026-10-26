import { describe, it, expect } from 'vitest';
import { documentToHtml, documentToMarkdown, exportFile, MAX_EXPORT_CHARS } from '@/lib/mcp/export';

const doc = JSON.stringify({
  blocks: [
    { type: 'header', data: { text: 'Plan', level: 2 } },
    { type: 'paragraph', data: { text: 'Hello <b>world</b> &amp; <script>x</script>' } },
    { type: 'list', data: { style: 'ordered', items: ['one', 'two'] } },
    { type: 'checklist', data: { items: [{ text: 'done', checked: true }, { text: 'todo', checked: false }] } },
    { type: 'table', data: { content: [['a', 'b'], ['1', '2']] } },
    { type: 'image', data: { file: { url: 'https://cdn.example.com/x.png' }, caption: 'Fig' } },
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
  });
  it('escapes everything in html (no script injection)', () => {
    const html = documentToHtml(doc, '<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('Hello world &amp; x');
    expect(html).toContain('<img src="https://cdn.example.com/x.png"');
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
    expect(exportFile({ fileName: 'f', document: '', whiteboard: wb }, 'svg').content).toContain('<svg');
  });
});
