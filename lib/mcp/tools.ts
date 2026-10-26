import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { casUpdateDocument, casUpdateWhiteboard } from '@/lib/cas-writes';
import { invalidateCachedFile } from '@/lib/redis-cache';
import { logAuditEvent } from '@/lib/audit';
import { parseJsonIfString, asEditorDocument, asWhiteboardPayload, asJsonString } from '@/lib/state-sync-helpers';
import { extractTextFromDocument, extractTextFromWhiteboard } from '@/lib/file-service';
import { searchIconLibraries, listLibraryItems, getLibraryIcon } from '@/lib/mcp/icon-libraries';
import { storeIconPlacement, takeIconPlacement } from '@/lib/mcp/icon-placement-cache';
import { createHash } from 'crypto';
import { exportFile } from '@/lib/mcp/export';
import { buildElements, defaultSize, layoutDiagram, validateSpec, type DiagramSpec, type SpecElement } from '@/lib/mcp/diagram-spec';
import { parseWhiteboardElements } from '@/lib/whiteboard-svg';

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
  /** Set when the caller authenticated via OAuth (a Claude connector) rather than an API key. */
  oauthClientId?: string;
  /** Public origin, used to hand back clickable file URLs. */
  baseUrl?: string;
  /**
   * Present only when the user's team has an AI provider configured (Settings
   * -> AI). Turns a natural-language request into a diagram spec using the
   * TEAM'S OWN provider key; collabpro_create_diagram/update_diagram are
   * registered only when this exists, so the server never spends tokens
   * unless an owner opted in.
   */
  generateSpec?: (instruction: string, existing?: string) => Promise<DiagramSpec>;
}

// Same "creator OR member" union every other access check in this app uses
// (app/api/state-sync/services/fileService.ts's org-scope listing,
// teamService.ts's getTeam) - a team's creator is never given their own
// TeamMember row (see teams:createTeam), so a TeamMember-only query here
// silently locked every team owner out of every MCP tool for their own
// team's files, including a brand new team with nothing but its owner in it.
async function getAllowedTeamIds(ctx: McpToolContext): Promise<string[]> {
  const [createdTeams, memberships] = await Promise.all([
    ctx.prisma.team.findMany({ where: { createdBy: ctx.userEmail }, select: { id: true } }),
    ctx.prisma.teamMember.findMany({ where: { userEmail: ctx.userEmail } }),
  ]);
  const ids = new Set<string>();
  for (const t of createdTeams) if (t.id) ids.add(t.id);
  for (const m of memberships) if (m.teamId) ids.add(m.teamId);
  return Array.from(ids);
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

// Every success result carries both a text block (what older clients render)
// and structuredContent (typed, validated against the tool's outputSchema).
// The JSON round-trip drops Dates etc. so the payload is always plain JSON.
function textResult(data: unknown) {
  const plain: unknown = JSON.parse(JSON.stringify(data ?? null));
  const structured = plain && typeof plain === 'object' && !Array.isArray(plain) ? (plain as Record<string, unknown>) : { items: plain };
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }], structuredContent: structured };
}

// Short content hash of one file field. get_file hands it out as a version and
// write tools accept it back as baseVersion, so an agent can detect that a
// human edited the file after it read it (optimistic concurrency, opt-in).
function fieldVersion(value: string | null | undefined): string {
  return createHash('sha256').update(value ?? '').digest('hex').slice(0, 16);
}

const baseVersionParam = z.string().optional()
  .describe('Optional. The documentVersion/whiteboardVersion from collabpro_get_file. If the file changed since, the write is rejected instead of overwriting someone else\'s edit.');

function fileUrl(ctx: McpToolContext, fileId: string): string | undefined {
  return ctx.baseUrl ? `${ctx.baseUrl}/workspace/${fileId}` : undefined;
}

function resourceLink(url: string | undefined, name: string) {
  return url ? [{ type: 'resource_link' as const, uri: url, name, mimeType: 'text/html' }] : [];
}

async function reportProgress(
  extra: { _meta?: { progressToken?: string | number }; sendNotification?: (n: any) => Promise<void> } | undefined,
  progress: number,
  total: number,
  message: string
) {
  const token = extra?._meta?.progressToken;
  if (token === undefined || !extra?.sendNotification) return;
  try {
    await extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress, total, message } });
  } catch {
    // Progress is best-effort; never fail the tool over it.
  }
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
    const el = raw as { id?: unknown; type?: unknown; x?: unknown; y?: unknown; width?: unknown; height?: unknown; groupIds?: unknown; strokeColor?: unknown; text?: unknown; points?: unknown };
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

    // The collabpro_diagram_guidelines prompt calls this out as the single
    // most common way a generated diagram ships visibly broken: an omitted
    // strokeColor can render invisible against the shape's background,
    // never wrong enough to be caught by anything checked above. A missing
    // color is never intentional (Excalidraw always has SOME visible
    // stroke), so this can't false-positive against a legitimate diagram.
    if (el.type === 'text' && (typeof el.strokeColor !== 'string' || el.strokeColor.trim() === '')) {
      issues.push(`Text element "${id}"${typeof el.text === 'string' ? ` ("${el.text}")` : ''}: missing strokeColor - text with no explicit color can render invisible against its background. Set one of the guideline's text colors (#1e293b/#334155/#64748b).`);
    }

    // Same rationale for arrow/line: the guidelines require width/height to
    // equal the points array's own bounding box, and call out "never 0 or
    // omitted" specifically because a zero-size arrow renders as nothing.
    // Checked leniently (points present and span non-zero, but declared
    // width AND height are both exactly 0) rather than requiring an exact
    // bbox match, so minor float rounding in a real computation never
    // trips this.
    if (el.type === 'arrow' || el.type === 'line') {
      if (!Array.isArray(el.points) || el.points.length < 2) {
        issues.push(`Element "${id}" (${el.type}): "points" needs at least 2 [dx, dy] pairs relative to (x, y).`);
      } else {
        const pts = el.points as unknown[];
        const dxs = pts.map((p) => (Array.isArray(p) && isFiniteNum(p[0]) ? p[0] : 0));
        const dys = pts.map((p) => (Array.isArray(p) && isFiniteNum(p[1]) ? p[1] : 0));
        const pointsSpanX = Math.max(...dxs) - Math.min(...dxs);
        const pointsSpanY = Math.max(...dys) - Math.min(...dys);
        if (el.width === 0 && el.height === 0 && (pointsSpanX > 0 || pointsSpanY > 0)) {
          issues.push(`Element "${id}" (${el.type}): width and height are both 0 but "points" spans a real distance - set width/height to the bounding box of points (max(dx)-min(dx), max(dy)-min(dy)), or it renders as a zero-length, invisible ${el.type}.`);
        }
      }
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
      description: 'Fetch files, folders, and collaborative workspaces matching your authenticated team scope. Paginated - pass the returned nextCursor back in to fetch the next page. Returns lightweight metadata only (not the full document/whiteboard content) - each file\'s "whiteboardText" is the text labels already on its canvas, letting you tell an empty canvas from one worth opening without a separate collabpro_get_file call per file; call collabpro_get_file on a specific fileId once you\'ve picked one.',
      inputSchema: {
        scope: z.enum(['org', 'team', 'personal']).default('org')
          .describe('The target view scope to load. Defaults to organization-wide org.'),
        teamId: z.string().optional().describe('Filter files belonging to a specific team ID.'),
        limit: z.number().int().min(1).max(200).default(50)
          .describe('Max files to return in this page (1-200, default 50).'),
        cursor: z.string().optional().describe('Opaque cursor from a previous call\'s nextCursor, to fetch the next page.'),
      },
      annotations: { title: 'List Files', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      outputSchema: { files: z.array(z.record(z.string(), z.unknown())), nextCursor: z.string().nullable() },
    },
    async (args) => {
      const allowedTeamIds = await getAllowedTeamIds(ctx);
      const files = await ctx.prisma.file.findMany({
        where: {
          teamId: args.teamId && allowedTeamIds.includes(args.teamId) ? args.teamId : { in: allowedTeamIds },
          archive: false,
        },
        orderBy: { createdAt: 'desc' },
        // Same listSelect as the dashboard's own files:getFiles (Issue 190) -
        // excludes the full document/whiteboard blobs, which this handler
        // used to return in full for every file in the page (a 50-file list
        // could mean 50 complete canvases' worth of element JSON just to
        // enumerate filenames). whiteboardText is the cheap derived label
        // index, kept so a caller can spot which files actually have canvas
        // content without opening each one.
        select: {
          id: true,
          fileName: true,
          teamId: true,
          createdBy: true,
          archive: true,
          folder: true,
          createdAt: true,
          whiteboardText: true,
        },
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
      outputSchema: { id: z.string(), fileName: z.string(), teamId: z.string(), documentVersion: z.string(), whiteboardVersion: z.string(), fileUrl: z.string().optional() },
    },
    async ({ fileId }) => {
      const file = await getAuthorizedFile(ctx, fileId);
      if (!file) {
        return errorResult('File not found or access denied');
      }
      return textResult({ ...file, documentVersion: fieldVersion(file.document), whiteboardVersion: fieldVersion(file.whiteboard), fileUrl: fileUrl(ctx, file.id) });
    }
  );

  server.registerTool(
    'collabpro_create_file',
    {
      description: 'Create a new CollabPro document/whiteboard file inside a team you belong to. Leave document/whiteboard unset to start blank - seed them the same way collabpro_update_document/collabpro_update_whiteboard accept.',
      inputSchema: {
        fileName: z.string().min(1).describe('Display name for the new file.'),
        teamId: z.string().describe('Team ID to create this file under - must be one of your authenticated teams (see collabpro_list_files).'),
        document: z.union([z.string(), z.record(z.string(), z.unknown())]).optional()
          .describe('Optional initial Editor.js payload (object or JSON string). Omit for a blank document.'),
        whiteboard: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]).optional()
          .describe('Optional initial Excalidraw elements (array or JSON string). Omit for a blank whiteboard.'),
        folder: z.string().optional().describe('Optional folder path to file this under, e.g. "Design/Mockups".'),
      },
      annotations: { title: 'Create File', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      outputSchema: { created: z.boolean(), file: z.record(z.string(), z.unknown()), fileUrl: z.string().optional() },
    },
    async ({ fileName, teamId, document, whiteboard, folder }) => {
      if (ctx.scope === 'read-only') {
        return errorResult('Forbidden: API key has read-only access scope');
      }
      const allowedTeamIds = await getAllowedTeamIds(ctx);
      if (!allowedTeamIds.includes(teamId)) {
        return errorResult('Team not found or access denied');
      }

      // Same normalization casUpdateDocument/casUpdateWhiteboard apply on
      // every write, so a file created here behaves identically to one
      // seeded by the dashboard's "New File" flow then edited through the
      // editor - no format drift between create and update paths.
      const documentString = document === undefined ? '' : asJsonString(asEditorDocument(document));
      const whiteboardString = whiteboard === undefined ? '' : asJsonString(asWhiteboardPayload(whiteboard));

      const file = await ctx.prisma.file.create({
        data: {
          fileName,
          teamId,
          createdBy: ctx.userEmail,
          document: documentString,
          whiteboard: whiteboardString,
          whiteboardText: whiteboardString ? extractTextFromWhiteboard(whiteboardString) : '',
          folder: folder ?? null,
        },
      });

      void logAuditEvent(teamId, ctx.userEmail, 'mcp:create_file', { fileId: file.id, oauthClientId: ctx.oauthClientId }, ctx.ip);

      return { ...textResult({ created: true, file, fileUrl: fileUrl(ctx, file.id) }), content: [{ type: 'text' as const, text: JSON.stringify({ created: true, file }, null, 2) }, ...resourceLink(fileUrl(ctx, file.id), file.fileName)] };
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
        baseVersion: baseVersionParam,
      },
      annotations: { title: 'Update Document', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      outputSchema: { updated: z.boolean(), document: z.unknown(), documentVersion: z.string() },
    },
    async ({ fileId, document, baseVersion }) => {
      if (ctx.scope === 'read-only') {
        return errorResult('Forbidden: API key has read-only access scope');
      }
      const file = await getAuthorizedFile(ctx, fileId);
      if (!file) {
        return errorResult('File not found or access denied');
      }
      if (baseVersion && baseVersion !== fieldVersion(file.document)) {
        return errorResult('Conflict: the document changed since you read it. Re-read it with collabpro_get_file and merge your change.');
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
      void logAuditEvent(file.teamId, ctx.userEmail, 'mcp:update_document', { fileId, oauthClientId: ctx.oauthClientId }, ctx.ip);

      return textResult({ updated: true, document: savedDocument, documentVersion: fieldVersion(JSON.stringify(savedDocument)) });
    }
  );

  server.registerTool(
    'collabpro_update_whiteboard',
    {
      description: 'Programmatically add or update vector drawings and architecture coordinate elements on a file whiteboard. Fetch the "collabpro_diagram_guidelines" prompt (prompts/get) first for the full color palette, spacing, and typography rules - it produces a much cleaner result than ad-hoc coordinates. Layout is enforced server-side, not just suggested: shapes (rectangle/ellipse/diamond) that overlap are REJECTED with a specific error naming the two offending elements - fix and retry. Minimum bar: every x/y/width/height must be a finite number >= 0; every text element needs a non-empty strokeColor; for arrow/line elements, "points" needs 2+ [dx,dy] pairs relative to (x,y), and width/height must not both be 0 when those points span a real distance. To place library icons (from collabpro_get_library_icon) without re-passing their full geometry, list their refs in "iconRefs". By DEFAULT this tool MERGES "whiteboard" onto whatever is already on the board (elements matched and added/updated by id, nothing else touched) - this is what you want on every call in a multi-step diagram build, since a later call must never discard an earlier one\'s work. Pass "deleted" (element ids) to remove specific elements. Only set "replaceAll":true for a genuine full-board regenerate, where "whiteboard" becomes the ENTIRE new board and anything not included is discarded.',
      inputSchema: {
        fileId: z.string().describe('The target file ID.'),
        whiteboard: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]).optional()
          .describe('Elements to add or update (matched onto the existing board by id in the default merge mode), or a JSON string of the same shape. Optional if you\'re only placing icons via "iconRefs" or removing elements via "deleted".'),
        iconRefs: z.array(z.string()).optional()
          .describe('"ref" values from prior collabpro_get_library_icon calls, to place those icons without re-passing their full element geometry. Merged in alongside "whiteboard". Each ref is single-use and expires after 30 minutes.'),
        deleted: z.array(z.string()).optional()
          .describe('Element ids to remove from the board. Only applies in the default merge mode - ignored if "replaceAll" is true, since a full replace already implies removing anything not included.'),
        baseVersion: baseVersionParam,
        replaceAll: z.boolean().optional()
          .describe('If true, "whiteboard" REPLACES the entire board - matches how the human editor autosaves its full canvas state. DESTRUCTIVE: anything already on the board that "whiteboard" doesn\'t include is discarded. Default false (merge) is almost always what you want; only set this for a deliberate full regenerate.'),
      },
      annotations: { title: 'Update Whiteboard', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      outputSchema: { updated: z.boolean(), whiteboard: z.unknown(), whiteboardVersion: z.string() },
    },
    async ({ fileId, whiteboard, iconRefs, deleted, replaceAll, baseVersion }) => {
      if (ctx.scope === 'read-only') {
        return errorResult('Forbidden: API key has read-only access scope');
      }
      if (replaceAll && whiteboard === undefined) {
        return errorResult('"whiteboard" is required when "replaceAll" is true.');
      }
      if (whiteboard === undefined && (!iconRefs || iconRefs.length === 0) && (!deleted || deleted.length === 0)) {
        return errorResult('Provide "whiteboard" content, "iconRefs" to place, "deleted" ids to remove, or some combination.');
      }
      const file = await getAuthorizedFile(ctx, fileId);
      if (!file) {
        return errorResult('File not found or access denied');
      }
      if (baseVersion && baseVersion !== fieldVersion(file.whiteboard)) {
        return errorResult('Conflict: the whiteboard changed since you read it. Re-read it with collabpro_get_file and merge your change.');
      }

      const resolvedIconElements: Record<string, unknown>[] = [];
      for (const ref of iconRefs ?? []) {
        const placement = takeIconPlacement(ref);
        if (!placement) {
          return errorResult(`Icon ref "${ref}" is unknown or has expired (refs are single-use and expire after 30 minutes) - fetch it again via collabpro_get_library_icon.`);
        }
        resolvedIconElements.push(...placement.elements);
      }

      const parsedIncoming = whiteboard === undefined ? undefined : parseJsonIfString(whiteboard);
      const isCallerDelta = !!parsedIncoming && typeof parsedIncoming === 'object' && !Array.isArray(parsedIncoming) && (parsedIncoming as any).isDelta;

      let payloadForWrite: unknown;
      let elementsToCheck: unknown[];

      if (replaceAll) {
        // Preserves the tool's original REPLACE behavior exactly - the
        // incoming payload (plus any resolved icons) becomes the board's
        // entire content, everything else is discarded. "deleted" is
        // ignored here: a full replace already implies removing anything
        // not present.
        if (resolvedIconElements.length === 0) {
          payloadForWrite = parsedIncoming;
        } else if (isCallerDelta) {
          const existingUpdated = Array.isArray((parsedIncoming as any).updated) ? (parsedIncoming as any).updated : [];
          payloadForWrite = { ...(parsedIncoming as any), updated: [...existingUpdated, ...resolvedIconElements] };
        } else if (Array.isArray(parsedIncoming)) {
          payloadForWrite = [...parsedIncoming, ...resolvedIconElements];
        } else if (parsedIncoming && typeof parsedIncoming === 'object' && Array.isArray((parsedIncoming as any).elements)) {
          payloadForWrite = { ...(parsedIncoming as any), elements: [...(parsedIncoming as any).elements, ...resolvedIconElements] };
        } else {
          payloadForWrite = resolvedIconElements;
        }
        elementsToCheck = isCallerDelta
          ? (Array.isArray((payloadForWrite as any).updated) ? (payloadForWrite as any).updated : [])
          : Array.isArray(payloadForWrite)
            ? payloadForWrite
            : (Array.isArray((payloadForWrite as any)?.elements) ? (payloadForWrite as any).elements : []);
      } else {
        // Default: MERGE. Always resolves to a delta envelope regardless of
        // what shape "whiteboard" arrived as - the fix for the exact
        // failure mode this tool used to have: call N+1 (e.g. placing the
        // next icon) must never silently discard everything call N already
        // wrote just because it only echoed a subset of the board.
        let updatedEls: unknown[];
        let deletedIds: unknown[];
        if (isCallerDelta) {
          updatedEls = Array.isArray((parsedIncoming as any).updated) ? (parsedIncoming as any).updated : [];
          deletedIds = Array.isArray((parsedIncoming as any).deleted) ? (parsedIncoming as any).deleted : [];
        } else if (Array.isArray(parsedIncoming)) {
          updatedEls = parsedIncoming;
          deletedIds = [];
        } else if (parsedIncoming && typeof parsedIncoming === 'object' && Array.isArray((parsedIncoming as any).elements)) {
          updatedEls = (parsedIncoming as any).elements;
          deletedIds = [];
        } else {
          updatedEls = [];
          deletedIds = [];
        }
        updatedEls = [...updatedEls, ...resolvedIconElements];
        deletedIds = [...deletedIds, ...(deleted ?? [])];
        payloadForWrite = { isDelta: true, updated: updatedEls, deleted: deletedIds };
        elementsToCheck = updatedEls;
      }

      const layoutIssues = validateWhiteboardGeometry(elementsToCheck);
      if (layoutIssues.length > 0) {
        return errorResult(`Whiteboard rejected - fix these layout issues and retry:\n- ${layoutIssues.join('\n- ')}`);
      }

      // casUpdateWhiteboard returns the final whiteboard as a JSON string
      // (unlike casUpdateDocument, which returns a plain object) - parse it
      // back before embedding, or it double-encodes as an escaped string.
      const savedWhiteboardString = await casUpdateWhiteboard(ctx.prisma, fileId, payloadForWrite, {
        onPersisted: (persistedId) => invalidateCachedFile(persistedId),
      });

      void logAuditEvent(file.teamId, ctx.userEmail, 'mcp:update_whiteboard', { fileId, oauthClientId: ctx.oauthClientId }, ctx.ip);

      return textResult({ updated: true, whiteboard: JSON.parse(savedWhiteboardString), whiteboardVersion: fieldVersion(savedWhiteboardString) });
    }
  );

  server.registerTool(
    'collabpro_search_icon_libraries',
    {
      description: 'Search the 200+ community Excalidraw icon libraries (AWS/Azure/GCP/network/UML/BPMN/etc, from libraries.excalidraw.com) by keyword. Returns each match\'s "source" - pass it to collabpro_list_library_items to see every icon it contains, or straight to collabpro_get_library_icon if you already know which item you want.',
      inputSchema: {
        query: z.string().min(1).describe('Keyword to match against library names/descriptions/item names, e.g. "aws", "azure", "network".'),
      },
      annotations: { title: 'Search Icon Libraries', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      outputSchema: { results: z.array(z.record(z.string(), z.unknown())) },
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
    'collabpro_list_library_items',
    {
      description: 'List every icon/item in one community Excalidraw library (see collabpro_search_icon_libraries\'s "source" field), each with a real name - not just an index. Most library files have no per-item metadata name at all, so this derives one the same way the in-app library picker does (the item\'s own text label, or its element type) rather than leaving you to guess numeric indices blind. Call this before collabpro_get_library_icon when you want to work through everything a library offers.',
      inputSchema: {
        librarySource: z.string().describe('Library file, e.g. "childishgirl/aws-architecture-icons.excalidrawlib" - from collabpro_search_icon_libraries\'s "source" field.'),
      },
      annotations: { title: 'List Library Items', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      outputSchema: { librarySource: z.string(), count: z.number(), items: z.array(z.record(z.string(), z.unknown())) },
    },
    async ({ librarySource }) => {
      try {
        const items = await listLibraryItems(librarySource);
        return textResult({ librarySource, count: items.length, items });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    'collabpro_get_library_icon',
    {
      description: 'Fetch and place one icon from a community Excalidraw library (see collabpro_search_icon_libraries) at (x, y). Returns a short-lived "ref" instead of the icon\'s full element geometry - pass that ref straight into collabpro_update_whiteboard\'s "iconRefs" array to drop it onto the board, without ever having to read or re-emit the raw shapes yourself. Building a diagram with several icons costs one of these calls per icon, then one collabpro_update_whiteboard call with all their refs together. Refs are single-use and expire after 30 minutes - place it or re-fetch it, but don\'t hold onto it past that.',
      inputSchema: {
        librarySource: z.string().describe('Library file, e.g. "husainkhambaty/aws-simple-icons.excalidrawlib" - from collabpro_search_icon_libraries\'s "source" field.'),
        item: z.string().describe('0-based item index (e.g. "3"), or a case-insensitive substring of the item name for libraries with named items.'),
        x: z.number().describe('Target x position for the icon (its own top-left corner).'),
        y: z.number().describe('Target y position for the icon (its own top-left corner).'),
        scale: z.number().positive().max(10).default(1).describe('Uniform scale factor. Default 1 (library\'s native size).'),
        idPrefix: z.string().optional().describe('Prefix for namespacing this icon\'s element/group IDs. Defaults to a random prefix; set your own for a stable, predictable ID.'),
      },
      annotations: { title: 'Get Library Icon', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      outputSchema: { name: z.string(), ref: z.string(), width: z.number(), height: z.number(), elementCount: z.number(), note: z.string() },
    },
    async ({ librarySource, item, x, y, scale, idPrefix }) => {
      try {
        const prefix = idPrefix || `icon${Math.random().toString(36).slice(2, 8)}`;
        const { name, elements, width, height } = await getLibraryIcon(librarySource, item, x, y, prefix, scale);
        const ref = storeIconPlacement(name, elements);
        return textResult({
          name, ref, width, height, elementCount: elements.length,
          note: 'Pass "ref" to collabpro_update_whiteboard\'s iconRefs array to place this icon - width/height is its footprint at (x, y) for planning the next icon\'s position without overlap.',
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );
  server.registerTool(
    'collabpro_list_teams',
    {
      description: 'List the teams you can access (id, name). Use a returned id as teamId for collabpro_create_file / collabpro_list_files / collabpro_search instead of guessing.',
      inputSchema: {},
      annotations: { title: 'List Teams', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      outputSchema: { teams: z.array(z.object({ id: z.string(), teamName: z.string(), description: z.string() })) },
    },
    async () => {
      const ids = await getAllowedTeamIds(ctx);
      const teams = ids.length
        ? await ctx.prisma.team.findMany({ where: { id: { in: ids } }, select: { id: true, teamName: true, description: true } })
        : [];
      return textResult({ teams });
    }
  );

  server.registerTool(
    'collabpro_search',
    {
      description: 'Full-text search across file names, document text and whiteboard labels in your teams. Returns matching files with a short snippet; call collabpro_get_file on the one you want. Case-insensitive substring match.',
      inputSchema: {
        query: z.string().min(2).max(200).describe('Text to look for.'),
        teamId: z.string().optional().describe('Restrict to one team (see collabpro_list_teams).'),
        limit: z.number().int().min(1).max(50).default(20).describe('Max results (1-50, default 20).'),
      },
      annotations: { title: 'Search Files', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      outputSchema: { results: z.array(z.object({ id: z.string(), fileName: z.string(), teamId: z.string(), folder: z.string().nullable(), snippet: z.string() })) },
    },
    async ({ query, teamId, limit }) => {
      const allowed = await getAllowedTeamIds(ctx);
      const contains = { contains: query, mode: 'insensitive' as const };
      const rows = await ctx.prisma.file.findMany({
        where: {
          teamId: teamId && allowed.includes(teamId) ? teamId : { in: allowed },
          archive: false,
          OR: [{ fileName: contains }, { whiteboardText: contains }, { document: contains }],
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, fileName: true, teamId: true, folder: true, whiteboardText: true, document: true },
        take: limit,
      });
      const needle = query.toLowerCase();
      const results = rows.map((f) => {
        const text = `${extractTextFromDocument(f.document)}\n${f.whiteboardText}`;
        const at = text.toLowerCase().indexOf(needle);
        const snippet = at < 0 ? '' : text.slice(Math.max(0, at - 60), at + needle.length + 100).replace(/\s+/g, ' ').trim();
        return { id: f.id, fileName: f.fileName, teamId: f.teamId, folder: f.folder ?? null, snippet };
      });
      return textResult({ results });
    }
  );

  server.registerTool(
    'collabpro_export_file',
    {
      description: 'Export a file as text: "svg" (the whiteboard rendered as SVG), "markdown" or "html" (the document), or "text" (plain document text). Output is capped at ~100k characters ("truncated": true if cut). For PNG or PDF use the Export menu in the CollabPro workspace.',
      inputSchema: {
        fileId: z.string().describe('The file to export.'),
        format: z.enum(['svg', 'markdown', 'html', 'text']).default('markdown').describe('Output format.'),
      },
      annotations: { title: 'Export File', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      outputSchema: { format: z.string(), mimeType: z.string(), truncated: z.boolean(), content: z.string() },
    },
    async ({ fileId, format }) => {
      const file = await getAuthorizedFile(ctx, fileId);
      if (!file) return errorResult('File not found or access denied');
      const out = exportFile(file, format);
      return textResult({ format, mimeType: out.mimeType, truncated: out.truncated, content: out.content });
    }
  );

  server.registerTool(
    'collabpro_place_icon',
    {
      description: 'One-step icon placement: describe the icon in words (e.g. "aws lambda", "kubernetes pod", "postgres"). Searches the community Excalidraw libraries, picks the best-named vector icon, and returns a "ref" for collabpro_update_whiteboard\'s iconRefs (single-use, 30 min) plus its width/height footprint at (x, y). Replaces the search -> list -> get sequence; those tools remain for browsing.',
      inputSchema: {
        query: z.string().min(2).max(100).describe('What the icon depicts, e.g. "aws s3".'),
        x: z.number().describe('Target x (icon top-left).'),
        y: z.number().describe('Target y (icon top-left).'),
        scale: z.number().positive().max(10).default(1).describe('Uniform scale factor.'),
      },
      annotations: { title: 'Place Icon', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      outputSchema: { name: z.string(), librarySource: z.string(), ref: z.string(), width: z.number(), height: z.number(), elementCount: z.number() },
    },
    async ({ query, x, y, scale }) => {
      try {
        const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
        const libs = new Map<string, true>();
        for (const t of tokens) {
          for (const lib of (await searchIconLibraries(t)).slice(0, 3)) libs.set(lib.source, true);
          if (libs.size >= 3) break;
        }
        const candidates = await Promise.all(
          [...libs.keys()].slice(0, 3).map(async (source) => {
            try { return { source, items: await listLibraryItems(source) }; } catch { return { source, items: [] }; }
          })
        );
        let best: { source: string; index: number; name: string; score: number; size: number } | null = null;
        for (const { source, items } of candidates) {
          for (const it of items) {
            if (it.hasImage) continue;
            const name = it.name.toLowerCase();
            const score = tokens.filter((t) => name.includes(t)).length;
            if (score === 0) continue;
            if (!best || score > best.score || (score === best.score && it.elementCount < best.size)) {
              best = { source, index: it.index, name: it.name, score, size: it.elementCount };
            }
          }
        }
        if (!best) return errorResult(`No vector icon matched "${query}". Try a shorter query, or browse with collabpro_search_icon_libraries.`);
        const prefix = `icon${Math.random().toString(36).slice(2, 8)}`;
        const icon = await getLibraryIcon(best.source, String(best.index), x, y, prefix, scale);
        const ref = storeIconPlacement(icon.name, icon.elements);
        return textResult({ name: icon.name, librarySource: best.source, ref, width: icon.width, height: icon.height, elementCount: icon.elements.length });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // Shared by apply_diagram_spec and the optional AI tools: validates a graph
  // spec, lays it out, resolves icon nodes, geometry-checks and writes it.
  async function applySpecToFile(
    file: NonNullable<Awaited<ReturnType<typeof getAuthorizedFile>>>,
    spec: DiagramSpec,
    replaceAll: boolean,
    baseVersion: string | undefined,
  ) {
    if (baseVersion && baseVersion !== fieldVersion(file.whiteboard)) {
      return errorResult('Conflict: the whiteboard changed since you read it. Re-read it with collabpro_get_file and retry.');
    }
    const specIssues = validateSpec(spec);
    if (specIssues.length > 0) return errorResult(`Invalid diagram spec:\n- ${specIssues.join('\n- ')}`);

    // Measure icon nodes at the origin first (the library fetch is cached),
    // so layout leaves room for their real footprint.
    const sizes = new Map<string, { w: number; h: number }>();
    const iconNodes = spec.nodes.filter((n) => n.icon);
    if (iconNodes.length > 20) return errorResult('At most 20 icon nodes per call.');
    try {
      await Promise.all(iconNodes.map(async (n) => {
        const m = await getLibraryIcon(n.icon!.librarySource, n.icon!.item, 0, 0, `m-${n.id}`, 1);
        sizes.set(n.id, { w: Math.max(m.width, 40), h: Math.max(m.height, 40) });
      }));
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
    for (const n of spec.nodes) if (!sizes.has(n.id)) sizes.set(n.id, defaultSize(n.label));

    // Merge mode drops the new diagram below whatever is already on the board.
    let originY = 0;
    if (!replaceAll) {
      const existing = parseWhiteboardElements(file.whiteboard) as { y?: number; height?: number; isDeleted?: boolean }[];
      const bottoms = existing.filter((e) => !e.isDeleted).map((e) => (e.y ?? 0) + (e.height ?? 0));
      if (bottoms.length) originY = Math.max(...bottoms) + 80;
    }
    const boxes = layoutDiagram(spec, sizes);
    for (const b of boxes.values()) b.y += originY;

    const iconElements = new Map<string, SpecElement[]>();
    try {
      await Promise.all(iconNodes.map(async (n) => {
        const b = boxes.get(n.id)!;
        const placed = await getLibraryIcon(n.icon!.librarySource, n.icon!.item, b.x, b.y, `${n.id}-`, 1);
        iconElements.set(n.id, placed.elements);
      }));
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }

    const elements = buildElements(spec, boxes, iconElements);
    const issues = validateWhiteboardGeometry(elements);
    if (issues.length > 0) return errorResult(`Generated diagram failed layout checks:\n- ${issues.join('\n- ')}`);

    const payload = replaceAll ? elements : { isDelta: true, updated: elements, deleted: [] };
    const saved = await casUpdateWhiteboard(ctx.prisma, file.id, payload, { onPersisted: (id) => invalidateCachedFile(id) });
    void logAuditEvent(file.teamId, ctx.userEmail, 'mcp:apply_diagram_spec', { fileId: file.id, nodes: spec.nodes.length, oauthClientId: ctx.oauthClientId }, ctx.ip);
    const url = fileUrl(ctx, file.id);
    return {
      ...textResult({ updated: true, elementCount: elements.length, whiteboardVersion: fieldVersion(saved), fileUrl: url }),
      content: [{ type: 'text' as const, text: `Diagram written: ${spec.nodes.length} nodes, ${(spec.edges ?? []).length} edges.` }, ...resourceLink(url, file.fileName)],
    };
  }

  const specNodeSchema = z.object({
    id: z.string().min(1).max(60).describe('Unique id, referenced by edges.'),
    label: z.string().min(1).max(120).describe('Text shown on the node.'),
    group: z.string().max(60).optional().describe('Nodes with the same group share a color.'),
    icon: z.object({ librarySource: z.string(), item: z.string() }).optional()
      .describe('Render a library icon instead of a box (librarySource/item from collabpro_search_icon_libraries / list_library_items).'),
  });
  const specEdgeSchema = z.object({ from: z.string(), to: z.string(), label: z.string().max(80).optional() });
  const specOutput = { updated: z.boolean(), elementCount: z.number(), whiteboardVersion: z.string(), fileUrl: z.string().optional() };

  server.registerTool(
    'collabpro_apply_diagram_spec',
    {
      description: 'PREFERRED way to draw a diagram. Describe the graph - nodes, edges, optional groups/icons - and the server lays it out (layered, no overlaps), draws labeled boxes and bound arrows, and saves it. You never compute coordinates. By default the diagram is added below existing content; set replaceAll to start from a blank board. Use collabpro_update_whiteboard only for hand-placed drawing.',
      inputSchema: {
        fileId: z.string().describe('Target file.'),
        nodes: z.array(specNodeSchema).min(1).max(60),
        edges: z.array(specEdgeSchema).max(120).optional(),
        direction: z.enum(['right', 'down']).default('right').describe('Flow direction.'),
        replaceAll: z.boolean().default(false).describe('DESTRUCTIVE: replace the whole board instead of adding below existing content.'),
        baseVersion: baseVersionParam,
      },
      annotations: { title: 'Apply Diagram Spec', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      outputSchema: specOutput,
    },
    async ({ fileId, nodes, edges, direction, replaceAll, baseVersion }) => {
      if (ctx.scope === 'read-only') return errorResult('Forbidden: API key has read-only access scope');
      const file = await getAuthorizedFile(ctx, fileId);
      if (!file) return errorResult('File not found or access denied');
      return applySpecToFile(file, { nodes, edges, direction }, replaceAll, baseVersion);
    }
  );

  // Optional server-side AI. Registered only when the team has configured a
  // provider; the call spends THAT team's key, never ours.
  if (ctx.generateSpec) {
    const generate = ctx.generateSpec;
    server.registerTool(
      'collabpro_create_diagram',
      {
        description: 'Create a diagram from a plain-English description using your team\'s configured AI provider (costs that provider\'s tokens). Pass fileId to draw into an existing file, or teamId + fileName to create one. Equivalent to describing the graph yourself via collabpro_apply_diagram_spec - prefer that if you can, it is free.',
        inputSchema: {
          text: z.string().min(5).max(4000).describe('What to diagram, e.g. "checkout flow across web, API, payments and database".'),
          fileId: z.string().optional(),
          teamId: z.string().optional().describe('Required with fileName when creating a new file.'),
          fileName: z.string().optional(),
        },
        annotations: { title: 'Create Diagram (AI)', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        outputSchema: specOutput,
      },
      async ({ text, fileId, teamId, fileName }, extra) => {
        if (ctx.scope === 'read-only') return errorResult('Forbidden: API key has read-only access scope');
        let file = fileId ? await getAuthorizedFile(ctx, fileId) : null;
        if (fileId && !file) return errorResult('File not found or access denied');
        if (!file) {
          if (!teamId || !fileName) return errorResult('Provide fileId, or teamId and fileName to create a new file.');
          if (!(await getAllowedTeamIds(ctx)).includes(teamId)) return errorResult('Team not found or access denied');
        }
        await reportProgress(extra, 1, 3, 'Generating diagram spec');
        let spec: DiagramSpec;
        try {
          spec = await generate(text);
        } catch (err) {
          return errorResult(`AI generation failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        await reportProgress(extra, 2, 3, 'Laying out and saving');
        if (!file) {
          file = await ctx.prisma.file.create({ data: { fileName: fileName!, teamId: teamId!, createdBy: ctx.userEmail, document: '', whiteboard: '', whiteboardText: '' } });
          void logAuditEvent(teamId!, ctx.userEmail, 'mcp:create_file', { fileId: file.id, oauthClientId: ctx.oauthClientId }, ctx.ip);
        }
        const result = await applySpecToFile(file, spec, false, undefined);
        await reportProgress(extra, 3, 3, 'Done');
        return result;
      }
    );
  }
}
