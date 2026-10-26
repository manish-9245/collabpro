import { extractTextFromDocument } from '@/lib/file-service';
import { parseWhiteboardElements, renderWhiteboardSvg } from '@/lib/whiteboard-svg';

/**
 * Server-side file export for MCP clients. Output is capped to stay inside
 * Claude's ~150k-character tool-result limit; callers get `truncated: true`
 * rather than a result the client would reject outright.
 */
export const MAX_EXPORT_CHARS = 100_000;

type Block = { type?: string; data?: Record<string, any> };

function parseBlocks(document: string): Block[] {
  try {
    const parsed = JSON.parse(document);
    return Array.isArray(parsed?.blocks) ? parsed.blocks : [];
  } catch {
    return [];
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Editor.js stores inline HTML (<b>, <i>, <a>); keep the text, drop the tags.
const plain = (s: unknown) => String(s ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export function documentToMarkdown(document: string, title: string): string {
  const lines: string[] = [`# ${plain(title)}`, ''];
  for (const b of parseBlocks(document)) {
    const d = b.data ?? {};
    switch (b.type) {
      case 'header': lines.push(`${'#'.repeat(Math.min(6, Math.max(1, Number(d.level) || 2)))} ${plain(d.text)}`, ''); break;
      case 'paragraph': lines.push(plain(d.text), ''); break;
      case 'list':
        (d.items ?? []).forEach((it: any, i: number) => lines.push(`${d.style === 'ordered' ? `${i + 1}.` : '-'} ${plain(typeof it === 'string' ? it : it?.content)}`));
        lines.push('');
        break;
      case 'checklist': (d.items ?? []).forEach((it: any) => lines.push(`- [${it.checked ? 'x' : ' '}] ${plain(it.text)}`)); lines.push(''); break;
      case 'table': (d.content ?? []).forEach((row: unknown[], i: number) => {
        lines.push(`| ${row.map(plain).join(' | ')} |`);
        if (i === 0) lines.push(`| ${row.map(() => '---').join(' | ')} |`);
      }); lines.push(''); break;
      case 'image': if (d.file?.url) lines.push(`![${plain(d.caption)}](${d.file.url})`, ''); break;
      case 'warning': lines.push(`> **${plain(d.title)}** ${plain(d.message)}`, ''); break;
      default: if (typeof d.text === 'string') lines.push(plain(d.text), '');
    }
  }
  return lines.join('\n').trim() + '\n';
}

export function documentToHtml(document: string, title: string): string {
  const out: string[] = [];
  for (const b of parseBlocks(document)) {
    const d = b.data ?? {};
    switch (b.type) {
      case 'header': { const l = Math.min(6, Math.max(1, Number(d.level) || 2)); out.push(`<h${l}>${esc(plain(d.text))}</h${l}>`); break; }
      case 'paragraph': out.push(`<p>${esc(plain(d.text))}</p>`); break;
      case 'list': { const tag = d.style === 'ordered' ? 'ol' : 'ul'; out.push(`<${tag}>${(d.items ?? []).map((it: any) => `<li>${esc(plain(typeof it === 'string' ? it : it?.content))}</li>`).join('')}</${tag}>`); break; }
      case 'checklist': out.push(`<ul>${(d.items ?? []).map((it: any) => `<li>${it.checked ? '&#9745;' : '&#9744;'} ${esc(plain(it.text))}</li>`).join('')}</ul>`); break;
      case 'table': out.push(`<table>${(d.content ?? []).map((r: unknown[]) => `<tr>${r.map((c) => `<td>${esc(plain(c))}</td>`).join('')}</tr>`).join('')}</table>`); break;
      case 'image': if (/^https?:\/\//.test(d.file?.url ?? '')) out.push(`<figure><img src="${esc(d.file.url)}" alt="${esc(plain(d.caption))}"/></figure>`); break;
      default: if (typeof d.text === 'string') out.push(`<p>${esc(plain(d.text))}</p>`);
    }
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(plain(title))}</title></head><body><h1>${esc(plain(title))}</h1>${out.join('\n')}</body></html>`;
}

export type ExportFormat = 'svg' | 'markdown' | 'html' | 'text';

export function exportFile(file: { fileName: string; document: string; whiteboard: string }, format: ExportFormat): { content: string; mimeType: string; truncated: boolean } {
  let content: string;
  let mimeType: string;
  switch (format) {
    case 'svg': content = renderWhiteboardSvg(parseWhiteboardElements(file.whiteboard), file.fileName); mimeType = 'image/svg+xml'; break;
    case 'markdown': content = documentToMarkdown(file.document, file.fileName); mimeType = 'text/markdown'; break;
    case 'html': content = documentToHtml(file.document, file.fileName); mimeType = 'text/html'; break;
    default: content = extractTextFromDocument(file.document); mimeType = 'text/plain';
  }
  const truncated = content.length > MAX_EXPORT_CHARS;
  return { content: truncated ? content.slice(0, MAX_EXPORT_CHARS) : content, mimeType, truncated };
}
