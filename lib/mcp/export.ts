import { decodeState } from '@/lib/state-encode';
import { parseWhiteboardElements, renderWhiteboardSvg } from '@/lib/whiteboard-svg';

/**
 * Server-side file export for MCP clients. Output is capped to stay inside
 * Claude's ~150k-character tool-result limit; callers get `truncated: true`
 * rather than a result the client would reject outright.
 */
export const MAX_EXPORT_CHARS = 100_000;

type Block = { type?: string; data?: Record<string, unknown> };
type Item = string | { content?: unknown; text?: unknown; checked?: unknown };

/** Stored documents may still be legacy-encoded; decode before reading, like every other read path. */
function parseBlocks(document: string): Block[] {
  const decoded = decodeState(document, null) as { blocks?: unknown } | null;
  return Array.isArray(decoded?.blocks) ? (decoded.blocks as Block[]) : [];
}

function decodedWhiteboard(whiteboard: string): string {
  const decoded = decodeState(whiteboard, null);
  return decoded === null ? whiteboard : JSON.stringify(decoded);
}

const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function str(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

// Editor.js stores inline HTML (<b>, <i>, <a>); keep the text, drop the tags.
// Tags are removed with a linear scan (no regex backtracking on hostile input).
// A "<" only opens a tag when followed by a letter, "/", "!" or "?" (as in HTML
// parsing), so text like "2 < 3" survives; a tag that never closes is kept as text.
function stripTags(html: string): string {
  let out = '';
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === '<' && /[A-Za-z/!?]/.test(html[i + 1] ?? '')) {
      const end = html.indexOf('>', i + 1);
      if (end === -1) {
        out += html.slice(i);
        break;
      }
      i = end + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function plain(value: unknown): string {
  const withBreaks = str(value).replaceAll(/<br\s*\/?>/gi, '\n');
  return stripTags(withBreaks).replaceAll('&nbsp;', ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

const itemText = (item: Item): string => (typeof item === 'string' ? plain(item) : plain(item?.content ?? item?.text));
const isChecked = (item: Item): boolean => typeof item === 'object' && item !== null && item.checked === true;
const list = (value: unknown): Item[] => (Array.isArray(value) ? (value as Item[]) : []);
const rows = (value: unknown): unknown[][] => (Array.isArray(value) ? (value as unknown[][]) : []);
const level = (value: unknown) => Math.min(6, Math.max(1, Number(value) || 2));
const imageUrl = (d: Record<string, unknown>): string => str((d.file as { url?: unknown } | undefined)?.url);

function blockToMarkdown(b: Block): string[] {
  const d = b.data ?? {};
  switch (b.type) {
    case 'header': return [`${'#'.repeat(level(d.level))} ${plain(d.text)}`, ''];
    case 'paragraph': return [plain(d.text), ''];
    case 'list': return [...list(d.items).map((it, i) => `${d.style === 'ordered' ? `${i + 1}.` : '-'} ${itemText(it)}`), ''];
    case 'checklist': return [...list(d.items).map((it) => `- [${isChecked(it) ? 'x' : ' '}] ${itemText(it)}`), ''];
    case 'table': return [...tableMarkdown(rows(d.content)), ''];
    case 'image': return imageUrl(d) ? [`![${plain(d.caption)}](${imageUrl(d)})`, ''] : [];
    case 'warning': return [`> **${plain(d.title)}** ${plain(d.message)}`, ''];
    default: return typeof d.text === 'string' ? [plain(d.text), ''] : [];
  }
}

function tableMarkdown(content: unknown[][]): string[] {
  const out: string[] = [];
  content.forEach((row, i) => {
    out.push(`| ${row.map(plain).join(' | ')} |`);
    if (i === 0) out.push(`| ${row.map(() => '---').join(' | ')} |`);
  });
  return out;
}

export function documentToMarkdown(document: string, title: string): string {
  const lines = [`# ${plain(title)}`, '', ...parseBlocks(document).flatMap(blockToMarkdown)];
  return `${lines.join('\n').trim()}\n`;
}

function blockToHtml(b: Block): string {
  const d = b.data ?? {};
  switch (b.type) {
    case 'header': { const l = level(d.level); return `<h${l}>${esc(plain(d.text))}</h${l}>`; }
    case 'paragraph': return `<p>${esc(plain(d.text))}</p>`;
    case 'list': return listHtml(d);
    case 'checklist': return `<ul>${list(d.items).map((it) => `<li>${isChecked(it) ? '&#9745;' : '&#9744;'} ${esc(itemText(it))}</li>`).join('')}</ul>`;
    case 'table': return `<table>${rows(d.content).map((r) => `<tr>${r.map((c) => `<td>${esc(plain(c))}</td>`).join('')}</tr>`).join('')}</table>`;
    case 'image': return /^https?:\/\//.test(imageUrl(d)) ? `<figure><img src="${esc(imageUrl(d))}" alt="${esc(plain(d.caption))}"/></figure>` : '';
    case 'warning': return `<blockquote><strong>${esc(plain(d.title))}</strong> ${esc(plain(d.message))}</blockquote>`;
    default: return typeof d.text === 'string' ? `<p>${esc(plain(d.text))}</p>` : '';
  }
}

function listHtml(d: Record<string, unknown>): string {
  const tag = d.style === 'ordered' ? 'ol' : 'ul';
  const items = list(d.items).map((it) => `<li>${esc(itemText(it))}</li>`).join('');
  return `<${tag}>${items}</${tag}>`;
}

export function documentToHtml(document: string, title: string): string {
  const body = parseBlocks(document).map(blockToHtml).filter(Boolean).join('\n');
  const heading = esc(plain(title));
  return `<!doctype html><html><head><meta charset="utf-8"><title>${heading}</title></head><body><h1>${heading}</h1>${body}</body></html>`;
}

/** Plain text of the document, including checklist items (Editor.js stores those as objects). */
export function documentToText(document: string): string {
  return parseBlocks(document)
    .flatMap((b): string[] => {
      const d = b.data ?? {};
      switch (b.type) {
        case 'list': case 'checklist': return list(d.items).map(itemText);
        case 'table': return rows(d.content).map((r) => r.map(plain).join(' | '));
        case 'warning': return [`${plain(d.title)} ${plain(d.message)}`.trim()];
        case 'image': return d.caption ? [plain(d.caption)] : [];
        default: return typeof d.text === 'string' ? [plain(d.text)] : [];
      }
    })
    .filter(Boolean)
    .join('\n');
}

export type ExportFormat = 'svg' | 'markdown' | 'html' | 'text';

export function exportFile(file: { fileName: string; document: string; whiteboard: string }, format: ExportFormat): { content: string; mimeType: string; truncated: boolean } {
  let content: string;
  let mimeType: string;
  switch (format) {
    case 'svg': content = renderWhiteboardSvg(parseWhiteboardElements(decodedWhiteboard(file.whiteboard)), file.fileName); mimeType = 'image/svg+xml'; break;
    case 'markdown': content = documentToMarkdown(file.document, file.fileName); mimeType = 'text/markdown'; break;
    case 'html': content = documentToHtml(file.document, file.fileName); mimeType = 'text/html'; break;
    default: content = documentToText(file.document); mimeType = 'text/plain';
  }
  const truncated = content.length > MAX_EXPORT_CHARS;
  return { content: truncated ? content.slice(0, MAX_EXPORT_CHARS) : content, mimeType, truncated };
}
