#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * CollabPro MCP stdio bridge.
 *
 * app/api/mcp/route.ts is CollabPro's real MCP server - a spec-compliant
 * Streamable HTTP transport any modern MCP client can connect to directly
 * (no local process needed at all). This script exists only for clients
 * that still require a local stdio server: it's a thin, stateless
 * message-forwarding bridge between the local client's stdio connection and
 * that same remote HTTP server - it defines no tools, schemas, or business
 * logic of its own, so there is nothing here to drift out of sync with the
 * real server.
 */

const apiKey = process.env.COLLABPRO_API_KEY;
const baseUrl = process.env.COLLABPRO_BASE_URL || 'http://localhost:3000';

function logDebug(msg: string) {
  // Stdio MCP uses stdout for protocol messages, so stderr must be used for any logging/debugging!
  process.stderr.write(`[CollabPro MCP Bridge] ${msg}\n`);
}

if (!apiKey) {
  logDebug('ERROR: COLLABPRO_API_KEY environment variable is not defined.');
  process.exit(1);
}

async function main() {
  const stdioTransport = new StdioServerTransport();
  const httpTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/api/mcp`), {
    requestInit: {
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  });

  stdioTransport.onmessage = (message) => {
    httpTransport.send(message).catch((err) => logDebug(`Failed forwarding request to remote server: ${err.message}`));
  };
  httpTransport.onmessage = (message) => {
    stdioTransport.send(message).catch((err) => logDebug(`Failed forwarding response to local client: ${err.message}`));
  };

  stdioTransport.onerror = (err) => logDebug(`stdio transport error: ${err.message}`);
  httpTransport.onerror = (err) => logDebug(`HTTP transport error (is COLLABPRO_BASE_URL=${baseUrl} correct and reachable?): ${err.message}`);

  let shuttingDown = false;
  stdioTransport.onclose = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    httpTransport.close().catch(() => {});
    process.exit(0);
  };
  httpTransport.onclose = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stdioTransport.close().catch(() => {});
  };

  await httpTransport.start();
  await stdioTransport.start();

  logDebug(`Bridging local stdio <-> ${baseUrl}/api/mcp`);
}

main().catch((err) => {
  logDebug(`Fatal error: ${err.message}`);
  process.exit(1);
});
