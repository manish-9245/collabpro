import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { casUpdateDocument, casUpdateWhiteboard } from '@/lib/cas-writes';
import { invalidateCachedFile } from '@/lib/redis-cache';

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

// Registers every CollabPro tool onto an McpServer instance, bound to the
// given (already-authenticated) context. Called fresh per request in
// app/api/mcp/route.ts, since each HTTP call may come from a different
// API key/user.
export function registerCollabProTools(server: McpServer, ctx: McpToolContext) {
  server.registerTool(
    'collabpro_list_files',
    {
      description: 'Fetch all files, folders, and collaborative workspaces matching your authenticated team scope.',
      inputSchema: {
        scope: z.enum(['org', 'team', 'personal']).default('org')
          .describe('The target view scope to load. Defaults to organization-wide org.'),
        teamId: z.string().optional().describe('Filter files belonging to a specific team ID.'),
      },
    },
    async (args) => {
      const allowedTeamIds = await getAllowedTeamIds(ctx);
      const files = await ctx.prisma.file.findMany({
        where: {
          teamId: args.teamId && allowedTeamIds.includes(args.teamId) ? args.teamId : { in: allowedTeamIds },
          archive: false,
        },
        orderBy: { createdAt: 'desc' },
      });
      return textResult(files);
    }
  );

  server.registerTool(
    'collabpro_get_file',
    {
      description: 'Retrieve full rich text document blocks and whiteboard coordinate elements for a specific CollabPro file.',
      inputSchema: {
        fileId: z.string().describe('The absolute file UUID to fetch.'),
      },
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

      return textResult({ updated: true, document: savedDocument });
    }
  );

  server.registerTool(
    'collabpro_update_whiteboard',
    {
      description: 'Programmatically push new vector drawings and architecture coordinate elements onto a file whiteboard.',
      inputSchema: {
        fileId: z.string().describe('The target file ID.'),
        whiteboard: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))])
          .describe('List of Excalidraw-compatible element objects, or a JSON string of the same shape.'),
      },
    },
    async ({ fileId, whiteboard }) => {
      if (ctx.scope === 'read-only') {
        return errorResult('Forbidden: API key has read-only access scope');
      }
      const file = await getAuthorizedFile(ctx, fileId);
      if (!file) {
        return errorResult('File not found or access denied');
      }

      // casUpdateWhiteboard returns the final whiteboard as a JSON string
      // (unlike casUpdateDocument, which returns a plain object) - parse it
      // back before embedding, or it double-encodes as an escaped string.
      const savedWhiteboardString = await casUpdateWhiteboard(ctx.prisma, fileId, whiteboard, {
        onPersisted: (persistedId) => invalidateCachedFile(persistedId),
      });

      return textResult({ updated: true, whiteboard: JSON.parse(savedWhiteboardString) });
    }
  );
}
