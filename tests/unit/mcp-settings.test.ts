import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

// Issue found in review: this file previously asserted against hand-copied
// object literals it built itself, never importing or rendering the real
// component - so it kept "passing" even after the real component started
// generating a config with the wrong env var name (COLLABPRO_URL instead of
// the COLLABPRO_BASE_URL the server actually reads). These tests render the
// real component and assert on what it actually outputs.

vi.mock('@/lib/session-auth/client', () => ({
  useSessionAuth: () => ({ user: { email: 'dev@collabpro.com', given_name: 'Dev' } }),
}));

vi.mock('../../app/(routes)/dashboard/_components/Header', () => ({
  default: () => null,
}));

const mockFetch = vi.fn();

describe('MCP Client Integration Settings Hub Suite (Issue 41)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
    mockFetch.mockImplementation(async (url: string) => {
      if (url === '/api/api-keys') {
        return {
          ok: true,
          json: async () => ({
            apiKeys: [{ id: 'key-1', name: 'My Key', key: 'collabpro_pat_abc123xyz' }],
          }),
        };
      }
      if (url === '/api/mcp') {
        return {
          ok: true,
          json: async () => ({ jsonrpc: '2.0', result: { protocolVersion: '2024-11-05', tools: [{ name: 'collabpro_list_files' }] }, id: 1 }),
        };
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });
  });

  it('generates a Claude Desktop config using COLLABPRO_BASE_URL - the env var the stdio server actually reads', async () => {
    const { default: McpSettingsHub } = await import('@/app/(routes)/dashboard/settings/mcp/page');
    render(React.createElement(McpSettingsHub));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/api-keys'));

    const configBlock = await screen.findByText(/mcpServers/);
    expect(configBlock.textContent).toContain('"COLLABPRO_BASE_URL"');
    expect(configBlock.textContent).toContain('"COLLABPRO_API_KEY"');
    expect(configBlock.textContent).not.toContain('"COLLABPRO_URL"');
  });

  it('generates a Cursor IDE env block using COLLABPRO_BASE_URL', async () => {
    const { default: McpSettingsHub } = await import('@/app/(routes)/dashboard/settings/mcp/page');
    render(React.createElement(McpSettingsHub));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/api-keys'));

    screen.getByText('Cursor IDE').click();

    const envBlock = await screen.findByText(/COLLABPRO_API_KEY=/);
    expect(envBlock.textContent).toContain('COLLABPRO_BASE_URL=');
    expect(envBlock.textContent).not.toMatch(/COLLABPRO_URL=/);
  });

  it('"Run Diagnostics" makes a real call to /api/mcp and shows the real returned tools, not a fabricated success', async () => {
    const { default: McpSettingsHub } = await import('@/app/(routes)/dashboard/settings/mcp/page');
    render(React.createElement(McpSettingsHub));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/api-keys'));

    screen.getByText('Run Handshake Diagnostics').click();

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/mcp', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer collabpro_pat_abc123xyz' }),
    })));

    // Real tool name from the mocked response, not the fabricated
    // collabpro_read_board/collabpro_write_board/collabpro_create_file
    // names the old hard-coded version always displayed regardless of
    // what the real server implements.
    await screen.findByText(/collabpro_list_files/);
    expect(screen.queryByText(/collabpro_read_board/)).toBeNull();
    expect(screen.queryByText(/collabpro_write_board/)).toBeNull();
  });

  it('"Run Diagnostics" shows a real failure when the API call fails, not a fabricated success', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url === '/api/api-keys') {
        return {
          ok: true,
          json: async () => ({ apiKeys: [{ id: 'key-1', name: 'My Key', key: 'collabpro_pat_abc123xyz' }] }),
        };
      }
      if (url === '/api/mcp') {
        return {
          ok: false,
          status: 403,
          json: async () => ({ jsonrpc: '2.0', error: { code: 403, message: 'Forbidden: API key has read-only access scope' } }),
        };
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });

    const { default: McpSettingsHub } = await import('@/app/(routes)/dashboard/settings/mcp/page');
    render(React.createElement(McpSettingsHub));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/api-keys'));
    screen.getByText('Run Handshake Diagnostics').click();

    await screen.findByText(/Forbidden/);
  });
});
