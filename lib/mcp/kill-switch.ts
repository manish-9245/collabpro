import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Operator kill switches, read from the environment on every request so a
 * Railway variable change takes effect on the next deploy/restart without a
 * code change:
 *   MCP_DISABLED=true          - /api/mcp answers 503 for everyone
 *   MCP_READ_ONLY=true         - every caller is forced to read-only scope
 *   MCP_DISABLED_TOOLS=a,b     - named tools are registered as disabled
 *   OAUTH_DISABLED=true        - OAuth endpoints and OAuth tokens stop working
 */
export function isMcpDisabled(): boolean {
  return process.env.MCP_DISABLED === 'true';
}

export function isMcpReadOnly(): boolean {
  return process.env.MCP_READ_ONLY === 'true';
}

export function disabledToolNames(): Set<string> {
  return new Set((process.env.MCP_DISABLED_TOOLS ?? '').split(',').map((s) => s.trim()).filter(Boolean));
}

/** Patches server.registerTool so disabled tools are registered then disabled (hidden from tools/list, uncallable). */
export function applyToolKillSwitch(server: McpServer): void {
  const disabled = disabledToolNames();
  if (disabled.size === 0) return;
  const original = server.registerTool.bind(server) as (...args: unknown[]) => { disable: () => void };
  (server as unknown as { registerTool: (...args: unknown[]) => unknown }).registerTool = (name: unknown, ...rest: unknown[]) => {
    const tool = original(name, ...rest);
    if (typeof name === 'string' && disabled.has(name)) tool.disable();
    return tool;
  };
}
