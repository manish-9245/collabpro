import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import http from 'node:http';
import path from 'path';

// Regression coverage for scripts/mcp-server.ts. The script is no longer a
// standalone MCP server with its own tool definitions - it's a thin
// stdio<->HTTP bridge that forwards every message to app/api/mcp/route.ts
// (the real, spec-compliant server). So testing it now means spinning up
// that real route (with the same DB/auth mocks the HTTP route tests use)
// behind an actual local HTTP listener, then spawning the bridge script via
// `tsx` and talking real newline-delimited JSON-RPC over its stdin/stdout,
// per the MCP stdio transport spec - confirming the bridge forwards
// messages faithfully in both directions, not that it re-implements tools.

const mockFindMany = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    teamMember: { findMany: (...args: any[]) => mockFindMany(...args) },
    file: { findMany: (...args: any[]) => mockFindMany(...args) },
  },
}));

vi.mock('@/lib/api-key-middleware', () => ({
  verifyApiKey: vi.fn().mockResolvedValue({ isValid: true, userEmail: 'dev@collabpro.com', scope: 'read-write' }),
}));

vi.mock('@/lib/redis-cache', () => ({
  invalidateCachedFile: vi.fn(),
  getCachedFile: vi.fn(),
}));

let backend: http.Server;
let backendUrl: string;
let child: ChildProcessWithoutNullStreams | null = null;

beforeAll(async () => {
  const { POST: mcpPOST } = await import('@/app/api/mcp/route');

  backend = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);

    const webReq = new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: body.length > 0 ? body : undefined,
    });

    const webRes = await mcpPOST(webReq);
    res.statusCode = webRes.status;
    webRes.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await webRes.arrayBuffer()));
  });

  await new Promise<void>((resolve) => backend.listen(0, resolve));
  const address = backend.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  backendUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

afterEach(() => {
  child?.kill();
  child = null;
});

function startBridge(env: Record<string, string>) {
  const scriptPath = path.resolve(__dirname, '../../scripts/mcp-server.ts');
  child = spawn('npx', ['tsx', scriptPath], {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, ...env },
  });
  return child;
}

function readOneLine(proc: ChildProcessWithoutNullStreams, timeoutMs = 10000): Promise<any> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let stderrBuf = '';
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for a stdout line. stderr so far: ${stderrBuf}`)), timeoutMs);
    proc.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });
    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx !== -1) {
        clearTimeout(timer);
        resolve(JSON.parse(buffer.slice(0, newlineIdx)));
      }
    });
  });
}

describe('scripts/mcp-server.ts stdio<->HTTP bridge', () => {
  it('forwards initialize to the real MCP route and relays its response back over stdio', async () => {
    const proc = startBridge({ COLLABPRO_API_KEY: 'test-key', COLLABPRO_BASE_URL: backendUrl });

    proc.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
      id: 1,
    }) + '\n');
    const response = await readOneLine(proc);

    expect(response.id).toBe(1);
    expect(response.result.protocolVersion).toBe('2024-11-05');
    expect(response.result.capabilities.tools).toBeTruthy();
  }, 15000);

  it('forwards tools/list and relays all real tool definitions back over stdio', async () => {
    const proc = startBridge({ COLLABPRO_API_KEY: 'test-key', COLLABPRO_BASE_URL: backendUrl });

    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 }) + '\n');
    const response = await readOneLine(proc);

    const toolNames = response.result.tools.map((t: any) => t.name);
    expect(toolNames).toEqual([
      'collabpro_list_files',
      'collabpro_get_file',
      'collabpro_update_document',
      'collabpro_update_whiteboard',
      'collabpro_search_icon_libraries',
      'collabpro_get_library_icon',
    ]);
  }, 15000);

  it('forwards tools/call and relays a real tool result back over stdio', async () => {
    mockFindMany.mockResolvedValueOnce([{ teamId: 'team-123' }]);
    mockFindMany.mockResolvedValueOnce([{ id: 'file-1', fileName: 'System Specs', teamId: 'team-123' }]);

    const proc = startBridge({ COLLABPRO_API_KEY: 'test-key', COLLABPRO_BASE_URL: backendUrl });

    proc.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'collabpro_list_files', arguments: { scope: 'team' } },
      id: 3,
    }) + '\n');
    const response = await readOneLine(proc);

    expect(response.result.content[0].text).toContain('System Specs');
  }, 15000);

  it('exits with an error and never starts bridging when COLLABPRO_API_KEY is missing', async () => {
    const proc = spawn('npx', ['tsx', path.resolve(__dirname, '../../scripts/mcp-server.ts')], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, COLLABPRO_API_KEY: '' },
    });
    child = proc;

    const exitCode = await new Promise<number | null>((resolve) => {
      proc.on('exit', (code) => resolve(code));
    });

    expect(exitCode).toBe(1);
  }, 15000);
});
