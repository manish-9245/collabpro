import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';

// Regression coverage for scripts/mcp-server.ts, which previously had zero
// test coverage at all - nothing spawned it, fed it stdin, or asserted on
// its stdout, so its actual JSON-RPC wire behavior (as opposed to the HTTP
// route's, which the other MCP tests exercise) was never verified.
//
// Spawns the real script via `tsx` (already a project devDependency - the
// same tool ws-server/server.ts is launched with) and talks real
// newline-delimited JSON-RPC over its actual stdin/stdout, per the MCP
// stdio transport spec.

let child: ChildProcessWithoutNullStreams | null = null;

afterEach(() => {
  child?.kill();
  child = null;
});

function startServer(env: Record<string, string>) {
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
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for a stdout line. stderr so far: ${stderrBuf}`)), timeoutMs);
    let stderrBuf = '';
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

describe('scripts/mcp-server.ts stdio transport (issue found in review: zero prior coverage)', () => {
  it('responds to initialize over real stdio with capabilities.tools declared', async () => {
    const proc = startServer({ COLLABPRO_API_KEY: 'test-key', COLLABPRO_BASE_URL: 'http://localhost:1' });

    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }) + '\n');
    const response = await readOneLine(proc);

    expect(response.id).toBe(1);
    expect(response.result.protocolVersion).toBe('2024-11-05');
    // Regression: this used to be `{}`, which is spec-non-compliant for a
    // server that offers tools.
    expect(response.result.capabilities).toEqual({ tools: {} });
  }, 15000);

  it('responds to tools/list with all 4 tools, including collabpro_update_document', async () => {
    const proc = startServer({ COLLABPRO_API_KEY: 'test-key', COLLABPRO_BASE_URL: 'http://localhost:1' });

    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 }) + '\n');
    const response = await readOneLine(proc);

    const toolNames = response.result.tools.map((t: any) => t.name);
    expect(toolNames).toEqual([
      'collabpro_list_files',
      'collabpro_get_file',
      'collabpro_update_document',
      'collabpro_update_whiteboard',
    ]);
  }, 15000);

  it('exits with an error and never starts listening when COLLABPRO_API_KEY is missing', async () => {
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
