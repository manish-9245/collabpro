import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyApiKey } from '@/lib/api-key-middleware';

export async function POST(request: Request) {
  try {
    // 1. Authorize API Key using Bearer Token header
    const authHeader = request.headers.get('Authorization');
    const authResult = await verifyApiKey(authHeader, request.method);
    
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
          capabilities: {},
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
                    type: 'string',
                    description: 'Editor.js structured payload as JSON string.'
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
                    type: 'string',
                    description: 'Excalidraw drawings as JSON string payload.'
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
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { code: 403, message: 'Forbidden: API key has read-only access scope' },
              id
            }, { status: 403 });
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
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { code: 404, message: 'File not found or access denied' },
              id
            }, { status: 404 });
          }

          const updatedFile = await prisma.file.update({
            where: { id: fileId },
            data: { document }
          });

          return NextResponse.json({
            jsonrpc: '2.0',
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(updatedFile, null, 2)
                }
              ]
            },
            id
          });
        }

        case 'collabpro_update_whiteboard': {
          if (authResult.scope === 'read-only') {
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { code: 403, message: 'Forbidden: API key has read-only access scope' },
              id
            }, { status: 403 });
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
            return NextResponse.json({
              jsonrpc: '2.0',
              error: { code: 404, message: 'File not found or access denied' },
              id
            }, { status: 404 });
          }

          const updatedFile = await prisma.file.update({
            where: { id: fileId },
            data: { whiteboard }
          });

          return NextResponse.json({
            jsonrpc: '2.0',
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(updatedFile, null, 2)
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
