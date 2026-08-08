import type { PrismaClient } from '@prisma/client';
import { casUpdateDocument, casUpdateWhiteboard } from '@/lib/cas-writes';
import { invalidateCachedFile } from '@/lib/redis-cache';
import { validateWhiteboardGeometry } from '@/lib/mcp/tools';
import { decodeState } from '@/lib/state-encode';

/**
 * OpenAI function-calling tools for the in-editor AI chat (app/api/ai/chat/
 * route.ts) - lets the assistant actually edit the file, not just talk about
 * it. Deliberately reuses the exact same mutation path and guardrails as the
 * MCP server's write tools (lib/mcp/tools.ts):
 *   - casUpdateDocument/casUpdateWhiteboard (lib/cas-writes.ts) - the same
 *     compare-and-swap writer every other write path in the app goes
 *     through, so a concurrent human edit can't be silently clobbered.
 *   - validateWhiteboardGeometry (exported from lib/mcp/tools.ts) - the same
 *     overlap/finite-number rejection, so a chat-drawn diagram can't be any
 *     shabbier than an MCP-drawn one. Single source of truth, not a fork.
 */
export const AI_CHAT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'update_document',
      description: 'Write or edit this file\'s document. Use this whenever the user asks you to write, draft, summarize into, or edit the document/notes - do not just describe the content in chat, actually write it here.',
      parameters: {
        type: 'object',
        properties: {
          blocks: {
            type: 'array',
            description: 'Editor.js blocks to write, each {type, data}. Common types: {type:"header", data:{text, level}}, {type:"paragraph", data:{text}}, {type:"list", data:{items: string[], style: "unordered"|"ordered"}}.',
            items: { type: 'object' },
          },
          mode: {
            type: 'string',
            enum: ['append', 'replace'],
            description: 'append (default) adds these blocks after the existing document. replace overwrites the whole document with just these blocks.',
          },
        },
        required: ['blocks'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_whiteboard',
      description: 'Draw on this file\'s whiteboard. Use this whenever the user asks you to draw, diagram, sketch, or visualize something - do not just describe it in chat, actually draw it. Elements are Excalidraw-compatible (rectangle/ellipse/diamond/arrow/line/text). Layout rules (enforced server-side, not optional): shapes may not overlap unless they share a groupIds entry (for one composite icon\'s deliberately-overlapping parts); give shapes 60px+ spacing; arrow "points" need 2+ [dx,dy] pairs with width/height equal to their bounding box.',
      parameters: {
        type: 'object',
        properties: {
          elements: {
            type: 'array',
            description: 'Excalidraw-compatible element objects to draw.',
            items: { type: 'object' },
          },
          mode: {
            type: 'string',
            enum: ['append', 'replace'],
            description: 'append (default) adds these elements to the existing whiteboard. replace overwrites the whole whiteboard with just these elements.',
          },
        },
        required: ['elements'],
      },
    },
  },
];

export interface ToolExecutionContext {
  prisma: PrismaClient;
  fileId: string;
}

export interface ToolExecutionResult {
  /** Shown to the user as an inline action marker, and fed back to the model as the tool result. */
  summary: string;
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export async function executeAiChatTool(
  toolName: string,
  rawArgs: string,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  let args: any;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    throw new Error(`Invalid arguments JSON for ${toolName}`);
  }

  if (toolName === 'update_document') {
    const blocks = Array.isArray(args.blocks) ? args.blocks : [];
    if (!blocks.length) throw new Error('blocks must be a non-empty array');
    const mode = args.mode === 'replace' ? 'replace' : 'append';

    let nextBlocks = blocks;
    if (mode === 'append') {
      const file = await ctx.prisma.file.findUnique({ where: { id: ctx.fileId }, select: { document: true } });
      const current = decodeState(file?.document, { blocks: [] });
      const currentBlocks = Array.isArray((current as any)?.blocks) ? (current as any).blocks : [];
      nextBlocks = [...currentBlocks, ...blocks];
    }

    await casUpdateDocument(
      ctx.prisma,
      ctx.fileId,
      { time: Date.now(), version: '2.8.1', blocks: nextBlocks },
      { onPersisted: (id) => invalidateCachedFile(id) }
    );
    return { summary: `${mode === 'replace' ? 'Replaced the document with' : 'Added'} ${pluralize(blocks.length, 'block')} to the document.` };
  }

  if (toolName === 'update_whiteboard') {
    const elements = Array.isArray(args.elements) ? args.elements : [];
    if (!elements.length) throw new Error('elements must be a non-empty array');
    const mode = args.mode === 'replace' ? 'replace' : 'append';

    // Same guardrail as collabpro_update_whiteboard (lib/mcp/tools.ts) - only
    // checks the new elements against each other (append) or the full board
    // (replace), never cross-checked against pre-existing content on append,
    // matching that tool's identical documented tradeoff.
    const issues = validateWhiteboardGeometry(elements);
    if (issues.length > 0) {
      throw new Error(`Whiteboard rejected - fix these layout issues and retry:\n- ${issues.join('\n- ')}`);
    }

    const payload = mode === 'replace' ? elements : { isDelta: true, updated: elements, deleted: [] };
    await casUpdateWhiteboard(ctx.prisma, ctx.fileId, payload, { onPersisted: (id) => invalidateCachedFile(id) });
    return { summary: `${mode === 'replace' ? 'Replaced the whiteboard with' : 'Added'} ${pluralize(elements.length, 'element')} to the whiteboard.` };
  }

  throw new Error(`Unknown tool: ${toolName}`);
}
