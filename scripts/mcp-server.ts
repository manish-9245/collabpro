#!/usr/bin/env node
import { writeFileSync } from 'fs';

/**
 * CollabPro Model Context Protocol (MCP) Standalone Server
 * Complies with the official JSON-RPC 2.0 Stdio specification.
 */

const apiKey = process.env.COLLABPRO_API_KEY;
const baseUrl = process.env.COLLABPRO_BASE_URL || 'http://localhost:3000';

function logDebug(msg: string) {
  // Stdio MCP uses stdout for protocol messages, so stderr must be used for any logging/debugging!
  process.stderr.write(`[CollabPro MCP Debug] ${msg}\n`);
}

if (!apiKey) {
  logDebug('ERROR: COLLABPRO_API_KEY environment variable is not defined.');
  process.exit(1);
}

// Buffer to store incoming chunks
let buffer = '';

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  let lineEnd = buffer.indexOf('\n');
  
  while (lineEnd !== -1) {
    const line = buffer.slice(0, lineEnd).trim();
    buffer = buffer.slice(lineEnd + 1);
    
    if (line) {
      handleRequest(line);
    }
    lineEnd = buffer.indexOf('\n');
  }
});

async function handleRequest(rawLine: string) {
  let request: any;
  try {
    request = JSON.parse(rawLine);
  } catch (err: any) {
    sendError(null, -32700, 'Parse error');
    return;
  }

  const { method, params, id } = request;
  logDebug(`Received request: ${method} (ID: ${id})`);

  if (method === 'initialize') {
    sendResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: {},
      serverInfo: {
        name: 'collabpro-mcp-server',
        version: '1.0.0'
      }
    });
    return;
  }

  if (method === 'notifications/initialized') {
    // Client acknowledgment, no response required
    return;
  }

  if (method === 'tools/list') {
    sendResponse(id, {
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
              },
              conflictStrategy: {
                type: 'string',
                enum: ['merge', 'overwrite', 'reject'],
                default: 'merge',
                description: 'Resolution strategy if file modified concurrently.'
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
              },
              conflictStrategy: {
                type: 'string',
                enum: ['merge', 'overwrite', 'reject'],
                default: 'merge',
                description: 'Strategy for resolving concurrent changes.'
              }
            },
            required: ['fileId', 'whiteboard']
          }
        }
      ]
    });
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    logDebug(`Calling tool: ${name}`);

    try {
      let syncPath = '';
      let syncArgs: any = {};

      switch (name) {
        case 'collabpro_list_files':
          syncPath = 'files:getFiles';
          syncArgs = {
            scope: args?.scope || 'org',
            teamId: args?.teamId
          };
          break;

        case 'collabpro_get_file':
          syncPath = 'files:getFileById';
          syncArgs = {
            _id: args?.fileId
          };
          break;

        case 'collabpro_update_document':
          syncPath = 'collabpro_update_document';
          syncArgs = {
            fileId: args?.fileId,
            document: args?.document,
            conflictStrategy: args?.conflictStrategy || 'merge'
          };
          break;

        case 'collabpro_update_whiteboard':
          syncPath = 'collabpro_update_whiteboard';
          syncArgs = {
            fileId: args?.fileId,
            whiteboard: args?.whiteboard,
            conflictStrategy: args?.conflictStrategy || 'merge'
          };
          break;

        default:
          sendError(id, -32601, `Tool ${name} not found`);
          return;
      }

      // Invoke state-sync REST API
      const response = await fetch(`${baseUrl}/api/state-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          path: syncPath,
          args: syncArgs
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        sendResponse(id, {
          content: [
            {
              type: 'text',
              text: `API request failed with status ${response.status}: ${errorText}`
            }
          ],
          isError: true
        });
        return;
      }

      const responseData: any = await response.json();
      
      if (responseData.error) {
        sendResponse(id, {
          content: [
            {
              type: 'text',
              text: `Error returned by state-sync: ${responseData.error}`
            }
          ],
          isError: true
        });
        return;
      }

      sendResponse(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(responseData.data, null, 2)
          }
        ]
      });

    } catch (err: any) {
      logDebug(`Tool execution error: ${err.message}`);
      sendResponse(id, {
        content: [
          {
            type: 'text',
            text: `Failed to call CollabPro tool: ${err.message}`
          }
        ],
        isError: true
      });
    }
    return;
  }

  // Fallback for unhandled methods
  sendError(id, -32601, 'Method not found');
}

function sendResponse(id: any, result: any) {
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id,
    result
  });
  process.stdout.write(payload + '\n');
}

function sendError(id: any, code: number, message: string) {
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code, message }
  });
  process.stdout.write(payload + '\n');
}
