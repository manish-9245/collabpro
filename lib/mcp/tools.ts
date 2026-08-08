import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { casUpdateDocument, casUpdateWhiteboard } from '@/lib/cas-writes';
import { invalidateCachedFile } from '@/lib/redis-cache';
import { logAuditEvent } from '@/lib/audit';
import { parseJsonIfString } from '@/lib/state-sync-helpers';
import { searchIconLibraries, getLibraryIcon } from '@/lib/mcp/icon-libraries';

/**
 * Canonical MCP tool registry - the single source of truth for every tool
 * CollabPro exposes over MCP, used by app/api/mcp/route.ts (the real,
 * spec-compliant Streamable HTTP server). scripts/mcp-server.ts no longer
 * has its own copy of these definitions at all - it's a stdio<->HTTP
 * bridge that talks to whichever server is registered here, which is what
 * eliminates the schema-drift class of bug that used to exist between two
 * independently hand-maintained tool lists.
 *
 * Input validation is handled by the SDK via these Zod schemas before a
 * handler ever runs - required fields missing or wrong-typed args are
 * rejected as a protocol-level error automatically, not something each
 * handler has to check for itself.
 */

export interface McpToolContext {
  prisma: PrismaClient;
  userEmail: string;
  scope: string | null;
  // Caller IP, threaded through purely for audit log entries on write tools -
  // this module never makes access decisions based on it.
  ip?: string;
}

async function getAllowedTeamIds(ctx: McpToolContext): Promise<string[]> {
  const memberships = await ctx.prisma.teamMember.findMany({
    where: { userEmail: ctx.userEmail },
  });
  return memberships.map((m) => m.teamId).filter(Boolean);
}

// Shared by every tool that operates on a single file: confirms the file
// exists and belongs to one of the caller's teams. Returns the file, or null
// if either check fails - callers turn a null into their own errorResult so
// the message can be tool-specific.
async function getAuthorizedFile(ctx: McpToolContext, fileId: string) {
  const allowedTeamIds = await getAllowedTeamIds(ctx);
  const file = await ctx.prisma.file.findUnique({ where: { id: fileId } });
  if (!file || !allowedTeamIds.includes(file.teamId)) {
    return null;
  }
  return file;
}

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

const MAX_WHITEBOARD_ELEMENTS = 500;
const MIN_SHAPE_GAP_PX = 4;

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Deterministic layout checks a whiteboard write must pass before it's
 * persisted. A tool *description* asking a caller nicely for good spacing is
 * only ever a hint an LLM can ignore - this is what actually forces it,
 * since every AI coding tool goes through this same handler regardless of
 * which model is driving it. Only covers full-snapshot writes (see caller):
 * a delta's `updated` elements are checked for sane numbers, but not
 * cross-checked against the rest of the board, since that would need an
 * extra read of the full current whiteboard for a comparatively rare path.
 *
 * Overlap is only flagged between shapes that share NO `groupIds` entry.
 * Found by actually round-tripping a real AWS icon (an ellipse + 3 nested
 * rectangles from a community .excalidrawlib, per the
 * collabpro_diagram_guidelines prompt's icon-library guidance) through this
 * validator: a multi-primitive icon's parts are *deliberately* overlapping -
 * that's how a vector icon is composed from primitives - and a same-group
 * pair sharing at least one groupIds entry is Excalidraw's own signal that
 * they're one visual unit, not two competing diagram nodes.
 */
export function validateWhiteboardGeometry(elements: unknown[]): string[] {
  const issues: string[] = [];
  if (elements.length > MAX_WHITEBOARD_ELEMENTS) {
    issues.push(`Too many elements (${elements.length}) - max ${MAX_WHITEBOARD_ELEMENTS} per whiteboard.`);
  }

  const shapes: { id: string; x: number; y: number; w: number; h: number; groupIds: string[] }[] = [];
  for (const raw of elements) {
    if (!raw || typeof raw !== 'object') continue;
    const el = raw as { id?: unknown; type?: unknown; x?: unknown; y?: unknown; width?: unknown; height?: unknown; groupIds?: unknown };
    const id = typeof el.id === 'string' ? el.id : '(missing id)';

    if (!isFiniteNum(el.x) || !isFiniteNum(el.y) || !isFiniteNum(el.width) || !isFiniteNum(el.height)) {
      issues.push(`Element "${id}": x, y, width, and height must all be finite numbers.`);
      continue;
    }
    if (el.width < 0 || el.height < 0) {
      issues.push(`Element "${id}": width/height must be >= 0 (got ${el.width}x${el.height}).`);
    }
    if (el.type === 'rectangle' || el.type === 'ellipse' || el.type === 'diamond') {
      const groupIds = Array.isArray(el.groupIds) ? el.groupIds.filter((g): g is string => typeof g === 'string') : [];
      shapes.push({ id, x: el.x, y: el.y, w: el.width, h: el.height, groupIds });
    }
  }

  // Pairwise bounding-box overlap among shapes only - arrows/text are
  // expected to sit on or near shape edges and aren't checked here.
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i], b = shapes[j];
      if (a.groupIds.some((g) => b.groupIds.includes(g))) continue;
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (overlapX > MIN_SHAPE_GAP_PX && overlapY > MIN_SHAPE_GAP_PX) {
        issues.push(`Shapes "${a.id}" and "${b.id}" overlap - give them at least ${MIN_SHAPE_GAP_PX}px of clear space (or, if they're meant to be one composite icon, give them a shared groupIds entry).`);
      }
    }
  }

  return issues;
}

// Registers every CollabPro tool onto an McpServer instance, bound to the
// given (already-authenticated) context. Called fresh per request in
// app/api/mcp/route.ts, since each HTTP call may come from a different
// API key/user.
export function registerCollabProTools(server: McpServer, ctx: McpToolContext) {
  server.registerTool(
    'collabpro_list_files',
    {
      description: 'Fetch files, folders, and collaborative workspaces matching your authenticated team scope. Paginated - pass the returned nextCursor back in to fetch the next page.',
      inputSchema: {
        scope: z.enum(['org', 'team', 'personal']).default('org')
          .describe('The target view scope to load. Defaults to organization-wide org.'),
        teamId: z.string().optional().describe('Filter files belonging to a specific team ID.'),
        limit: z.number().int().min(1).max(200).default(50)
          .describe('Max files to return in this page (1-200, default 50).'),
        cursor: z.string().optional().describe('Opaque cursor from a previous call\'s nextCursor, to fetch the next page.'),
      },
      annotations: { title: 'List Files', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      const allowedTeamIds = await getAllowedTeamIds(ctx);
      const files = await ctx.prisma.file.findMany({
        where: {
          teamId: args.teamId && allowedTeamIds.includes(args.teamId) ? args.teamId : { in: allowedTeamIds },
          archive: false,
        },
        orderBy: { createdAt: 'desc' },
        // Fetch one extra row to know whether a next page exists, without a
        // separate count query.
        take: args.limit + 1,
        ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      });
      const hasMore = files.length > args.limit;
      const page = hasMore ? files.slice(0, args.limit) : files;
      return textResult({ files: page, nextCursor: hasMore ? page[page.length - 1].id : null });
    }
  );

  server.registerTool(
    'collabpro_get_file',
    {
      description: 'Retrieve full rich text document blocks and whiteboard coordinate elements for a specific CollabPro file.',
      inputSchema: {
        fileId: z.string().describe('The absolute file UUID to fetch.'),
      },
      annotations: { title: 'Get File', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ fileId }) => {
      const file = await getAuthorizedFile(ctx, fileId);
      if (!file) {
        return errorResult('File not found or access denied');
      }
      return textResult(file);
    }
  );

  server.registerTool(
    'collabpro_update_document',
    {
      description: 'Programmatically update/overwrite a file document. Leverages block-level editing payloads.',
      inputSchema: {
        fileId: z.string().describe('The file ID to modify.'),
        document: z.union([z.string(), z.record(z.string(), z.unknown())])
          .describe('Editor.js structured payload (object), or a JSON string of the same shape.'),
      },
      annotations: { title: 'Update Document', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ fileId, document }) => {
      if (ctx.scope === 'read-only') {
        return errorResult('Forbidden: API key has read-only access scope');
      }
      const file = await getAuthorizedFile(ctx, fileId);
      if (!file) {
        return errorResult('File not found or access denied');
      }

      // Reuses the same compare-and-swap writer every other write path in
      // this app goes through (HTTP state-sync, the WS gateway), instead of
      // a raw prisma.file.update() with no conflict protection.
      const savedDocument = await casUpdateDocument(ctx.prisma, fileId, document, {
        onPersisted: (persistedId) => invalidateCachedFile(persistedId),
      });

      // An agentic caller overwriting content unattended is worth auditing
      // the same way other security-relevant actions in this app are,
      // unlike a routine human edit through the editor UI.
      void logAuditEvent(file.teamId, ctx.userEmail, 'mcp:update_document', { fileId }, ctx.ip);

      return textResult({ updated: true, document: savedDocument });
    }
  );

  server.registerTool(
    'collabpro_update_whiteboard',
    {
      description: 'Programmatically push new vector drawings and architecture coordinate elements onto a file whiteboard. Fetch the "collabpro_diagram_guidelines" prompt (prompts/get) first for the full color palette, spacing, and typography rules - it produces a much cleaner result than ad-hoc coordinates. Layout is enforced server-side, not just suggested: shapes (rectangle/ellipse/diamond) that overlap are REJECTED with a specific error naming the two offending elements - fix and retry. Minimum bar: every x/y/width/height must be a finite number >= 0; for arrow/line elements, "points" needs 2+ [dx,dy] pairs relative to (x,y), and width/height should equal the bounding box of those points (max(dx)-min(dx), max(dy)-min(dy)) - never 0 or omitted.',
      inputSchema: {
        fileId: z.string().describe('The target file ID.'),
        whiteboard: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))])
          .describe('List of Excalidraw-compatible element objects, or a JSON string of the same shape.'),
      },
      annotations: { title: 'Update Whiteboard', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ fileId, whiteboard }) => {
      if (ctx.scope === 'read-only') {
        return errorResult('Forbidden: API key has read-only access scope');
      }
      const file = await getAuthorizedFile(ctx, fileId);
      if (!file) {
        return errorResult('File not found or access denied');
      }

      const parsedIncoming = parseJsonIfString(whiteboard);
      const isDelta = !!parsedIncoming && typeof parsedIncoming === 'object' && !Array.isArray(parsedIncoming) && (parsedIncoming as any).isDelta;
      const elementsToCheck = isDelta
        ? (Array.isArray((parsedIncoming as any).updated) ? (parsedIncoming as any).updated : [])
        : Array.isArray(parsedIncoming)
          ? parsedIncoming
          : (Array.isArray((parsedIncoming as any)?.elements) ? (parsedIncoming as any).elements : []);

      const layoutIssues = validateWhiteboardGeometry(elementsToCheck);
      if (layoutIssues.length > 0) {
        return errorResult(`Whiteboard rejected - fix these layout issues and retry:\n- ${layoutIssues.join('\n- ')}`);
      }

      // casUpdateWhiteboard returns the final whiteboard as a JSON string
      // (unlike casUpdateDocument, which returns a plain object) - parse it
      // back before embedding, or it double-encodes as an escaped string.
      const savedWhiteboardString = await casUpdateWhiteboard(ctx.prisma, fileId, whiteboard, {
        onPersisted: (persistedId) => invalidateCachedFile(persistedId),
      });

      void logAuditEvent(file.teamId, ctx.userEmail, 'mcp:update_whiteboard', { fileId }, ctx.ip);

      return textResult({ updated: true, whiteboard: JSON.parse(savedWhiteboardString) });
    }
  );

  server.registerTool(
    'collabpro_search_icon_libraries',
    {
      description: 'Search the 200+ community Excalidraw icon libraries (AWS/Azure/GCP/network/UML/BPMN/etc, from libraries.excalidraw.com) by keyword. Returns each match\'s "source" - pass it to collabpro_get_library_icon to fetch a specific icon.',
      inputSchema: {
        query: z.string().min(1).describe('Keyword to match against library names/descriptions/item names, e.g. "aws", "azure", "network".'),
      },
      annotations: { title: 'Search Icon Libraries', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ query }) => {
      try {
        const results = await searchIconLibraries(query);
        return textResult({ results });
      } catch (err) {
        return errorResult(`Failed to search icon libraries: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  server.registerTool(
    'collabpro_get_library_icon',
    {
      description: 'Fetch one icon\'s elements from a community Excalidraw library (see collabpro_search_icon_libraries), translated to (x, y) and ID-namespaced so it drops into a whiteboard without collisions. Returns the elements verbatim - pass them straight into collabpro_update_whiteboard\'s "whiteboard" array alongside your other elements. Keep the returned groupIds as-is: an icon\'s parts are deliberately drawn overlapping (that\'s how a vector icon is composed from primitives), and shared groupIds is what tells collabpro_update_whiteboard\'s layout check they\'re one visual unit, not colliding diagram nodes.',
      inputSchema: {
        librarySource: z.string().describe('Library file, e.g. "husainkhambaty/aws-simple-icons.excalidrawlib" - from collabpro_search_icon_libraries\'s "source" field.'),
        item: z.string().describe('0-based item index (e.g. "3"), or a case-insensitive substring of the item name for libraries with named items.'),
        x: z.number().describe('Target x position for the icon (its own top-left corner).'),
        y: z.number().describe('Target y position for the icon (its own top-left corner).'),
        scale: z.number().positive().max(10).default(1).describe('Uniform scale factor. Default 1 (library\'s native size).'),
        idPrefix: z.string().optional().describe('Prefix for namespacing this icon\'s element/group IDs. Defaults to a random prefix; set your own for a stable, predictable ID.'),
      },
      annotations: { title: 'Get Library Icon', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ librarySource, item, x, y, scale, idPrefix }) => {
      try {
        const prefix = idPrefix || `icon${Math.random().toString(36).slice(2, 8)}`;
        const { name, elements } = await getLibraryIcon(librarySource, item, x, y, prefix, scale);
        return textResult({ name, elements });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );
}
