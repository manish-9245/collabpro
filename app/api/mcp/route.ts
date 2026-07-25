import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyApiKey } from '@/lib/api-key-middleware';
import { casUpdateDocument, casUpdateWhiteboard } from '@/lib/cas-writes';
import { invalidateCachedFile } from '@/lib/redis-cache';

function readOnlyForbidden(id: unknown) {
  return NextResponse.json({
    jsonrpc: '2.0',
    error: { code: 403, message: 'Forbidden: API key has read-only access scope' },
    id
  }, { status: 403 });
}

function fileNotFoundOrDenied(id: unknown) {
  return NextResponse.json({
    jsonrpc: '2.0',
    error: { code: 404, message: 'File not found or access denied' },
    id
  }, { status: 404 });
}

export async function POST(request: Request) {
  try {
    // 1. Authorize API Key using Bearer Token header
    // Scope enforcement happens per-tool below (collabpro_update_document /
    // collabpro_update_whiteboard already 403 read-only keys) - every call
    // here is an HTTP POST regardless of whether the JSON-RPC method is a
    // read or a write, so passing the HTTP verb through would reject every
    // read-only-scoped key on every call, including tools/list.
    const authHeader = request.headers.get('Authorization');
    const authResult = await verifyApiKey(authHeader);
    
    if (!authResult.isValid) {
      return NextResponse.json({
        jsonrpc: '2.0',
        error: {
          code: authResult.statusCode || 401,
          message: authResult.error || 'Unauthorized API Key'
        },
        id: null
      }, { status: authResult.statusCode || 401 });
    }

    // 2. Parse JSON-RPC Payload
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error' },
        id: null
      }, { status: 400 });
    }

    const { method, params, id } = body;
    if (!method) {
      return NextResponse.json({
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Invalid Request: method is required' },
        id: id || null
      }, { status: 400 });
    }

    // 3. Resolve Methods
    if (method === 'initialize') {
      return NextResponse.json({
        jsonrpc: '2.0',
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'collabpro-mcp-server-http',
            version: '1.0.0'
          }
        },
        id
      });
    }

    if (method === 'tools/list' || method === 'list_tools') {
      return NextResponse.json({
        jsonrpc: '2.0',
        result: {
          tools: [
            {
              name: 'collabpro_list_files',
              description: 'Fetch all files, folders, and collaborative workspaces matching your authenticated team scope.',
              inputSchema: {
                type: 'object',
                properties: {
                  scope: {
                    type: 'string',
                    enum: ['org', 'team', 'personal'],
                    description: 'The target view scope to load. Defaults to organization wide org.',
                    default: 'org'
                  },
                  teamId: {
                    type: 'string',
                    description: 'Filter files belonging to a specific team ID.'
                  }
                }
              }
            },
            {
              name: 'collabpro_get_file',
              description: 'Retrieve full rich text document blocks and whiteboard coordinate elements for a specific CollabPro file.',
              inputSchema: {
                type: 'object',
                properties: {
                  fileId: {
                    type: 'string',
                    description: 'The absolute file UUID to fetch.'
                  }
                },
                required: ['fileId']
              }
            },
            {
              name: 'collabpro_update_document',
              description: 'Programmatically update/overwrite a file document. Leverages block-level editing payloads.',
              inputSchema: {
                type: 'object',
                properties: {
                  fileId: {
                    type: 'string',
                    description: 'The file ID to modify.'
                  },
                  document: {
                    type: 'object',
                    description: 'Editor.js structured payload, or string to create a standard paragraph block.',
                    properties: {
                      blocks: {
                        type: 'array',
                        items: { type: 'object' }
                      }
                    }
                  }
                },
                required: ['fileId', 'document']
              }
            },
            {
              name: 'collabpro_update_whiteboard',
              description: 'Programmatically push new vector drawings and architecture coordinate elements onto a file whiteboard.',
              inputSchema: {
                type: 'object',
                properties: {
                  fileId: {
                    type: 'string',
                    description: 'The target file ID.'
                  },
                  whiteboard: {
                    type: 'array',
                    description: 'List of Excalidraw-compatible element objects to draw.',
                    items: { type: 'object' }
                  }
                },
                required: ['fileId', 'whiteboard']
              }
            }
          ]
        },
        id
      });
    }

    if (method === 'tools/call' || method === 'call_tool') {
      const toolName = params?.name || params?.tool;
      const args = params?.arguments || params?.args || {};

      if (!toolName) {
        return NextResponse.json({
          jsonrpc: '2.0',
          error: { code: -32602, message: 'Invalid params: name is required' },
          id
        }, { status: 400 });
      }

      // Resolve user's accessible teams
      const userMemberships = (await prisma.teamMember.findMany({
        where: { userEmail: authResult.userEmail || '' }
      })) || [];
      const allowedTeamIds = userMemberships.map(m => m?.teamId).filter(Boolean);

      switch (toolName) {
        case 'collabpro_list_files': {
          const files = await prisma.file.findMany({
            where: {
              teamId: args.teamId && allowedTeamIds.includes(args.teamId) ? args.teamId : { in: allowedTeamIds },
              archive: false
            },
            orderBy: { createdAt: 'desc' }
          });
          return NextResponse.json({
            jsonrpc: '2.0',
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(files, null, 2)
                }
              ]
            },
            id
          });
        }

        case 'collabpro_get_file': {
          const { fileId } = args;
          if (!fileId) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { code: -32602, message: 'Missing fileId argument' },
              id
            }, { status: 400 });
          }

          const file = await prisma.file.findUnique({
            where: { id: fileId }
          });

          if (!file || !allowedTeamIds.includes(file.teamId)) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { code: 404, message: 'File not found or access denied' },
              id
            }, { status: 404 });
          }

          return NextResponse.json({
            jsonrpc: '2.0',
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(file, null, 2)
                }
              ]
            },
            id
          });
        }

        case 'collabpro_update_document': {
          if (authResult.scope === 'read-only') {
            return readOnlyForbidden(id);
          }

          const { fileId, document } = args;
          if (!fileId || document === undefined) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { code: -32602, message: 'Missing fileId or document arguments' },
              id
            }, { status: 400 });
          }

          const file = await prisma.file.findUnique({
            where: { id: fileId }
          });

          if (!file || !allowedTeamIds.includes(file.teamId)) {
            return fileNotFoundOrDenied(id);
          }

          // Reuses the same compare-and-swap writer every other write path in
          // this app goes through (HTTP state-sync, the WS gateway, and now
          // this route), instead of a raw prisma.file.update() with no
          // conflict protection. Also accepts `document` as either a JSON
          // string or a structured Editor.js object - the schema drift
          // between this route and scripts/mcp-server.ts's tool schema is
          // gone because there's only one real acceptance path now.
          const savedDocument = await casUpdateDocument(prisma, fileId, document, {
            onPersisted: (persistedId) => invalidateCachedFile(persistedId),
          });

          return NextResponse.json({
            jsonrpc: '2.0',
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ updated: true, document: savedDocument }, null, 2)
                }
              ]
            },
            id
          });
        }

        case 'collabpro_update_whiteboard': {
          if (authResult.scope === 'read-only') {
            return readOnlyForbidden(id);
          }

          const { fileId, whiteboard } = args;
          if (!fileId || whiteboard === undefined) {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { code: -32602, message: 'Missing fileId or whiteboard arguments' },
              id
            }, { status: 400 });
          }

          const file = await prisma.file.findUnique({
            where: { id: fileId }
          });

          if (!file || !allowedTeamIds.includes(file.teamId)) {
            return fileNotFoundOrDenied(id);
          }

          // casUpdateWhiteboard returns the final whiteboard as a JSON
          // *string* (unlike casUpdateDocument, which returns a plain
          // object) - parse it back before embedding, or it double-encodes
          // as an escaped string inside this response instead of real JSON.
          const savedWhiteboard = JSON.parse(await casUpdateWhiteboard(prisma, fileId, whiteboard, {
            onPersisted: (persistedId) => invalidateCachedFile(persistedId),
          }));

          return NextResponse.json({
            jsonrpc: '2.0',
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ updated: true, whiteboard: savedWhiteboard }, null, 2)
                }
              ]
            },
            id
          });
        }

        default:
          return NextResponse.json({
            jsonrpc: '2.0',
            error: { code: -32601, message: 'Method not found' },
            id
          }, { status: 404 });
      }
    }

    return NextResponse.json({
      jsonrpc: '2.0',
      error: { code: -32601, message: 'Method not found' },
      id
    }, { status: 404 });

  } catch (error: any) {
    console.error('[MCP_POST]', error);
    return NextResponse.json({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'Internal error' },
      id: null
    }, { status: 500 });
  }
}
