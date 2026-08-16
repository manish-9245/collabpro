import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';

// Issue found in review: this file previously asserted against hand-copied
// object literals it built itself, never importing or rendering the real
// component - so it kept "passing" even after the real component started
// generating a config with the wrong env var name (COLLABPRO_URL instead of
// the COLLABPRO_BASE_URL the server actually reads). These tests render the
// real component and assert on what it actually outputs.
//
// This file's own mocked /api/api-keys response used to include a `key`
// field the real endpoint never returns (see app/api/api-keys/route.ts's GET
// handler - it only ever selects id/name/maskedKey/scope/createdAt/expiresAt;
// the raw secret is returned once, from POST, and never again). That fake
// shape hid the exact same class of bug this comment already warns about:
// production crashed with `Cannot read properties of undefined (reading
// 'substring')` on this page for any user with a real API key, because the
// component called `key.key.substring(...)` on a field that never existed.
// The mock below now matches the real response shape.

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
            apiKeys: [{ id: 'key-1', name: 'My Key', maskedKey: 'collabpro_pat_••••xyz123' }],
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

  it('renders cleanly with a real (masked-only) API key response, without throwing', async () => {
    const { default: McpSettingsHub } = await import('@/app/(routes)/dashboard/settings/mcp/page');
    render(React.createElement(McpSettingsHub));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/api-keys'));

    // Reference text shows the masked value - never throws trying to derive
    // a display substring from a raw key the list endpoint doesn't return.
    await screen.findByText(/collabpro_pat_••••xyz123/);
    const input = screen.getByPlaceholderText('YOUR_API_KEY_HERE') as HTMLInputElement;
    expect(input.value).toBe('YOUR_API_KEY_HERE');
  });

  it('defaults to the Remote (No Install) tab, showing the direct /api/mcp endpoint', async () => {
    const { default: McpSettingsHub } = await import('@/app/(routes)/dashboard/settings/mcp/page');
    render(React.createElement(McpSettingsHub));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/api-keys'));

    await screen.findByText('Server URL');
    const urlBlock = await screen.findByText(/^https?:\/\/.*\/api\/mcp$/);
    expect(urlBlock.textContent).toContain('/api/mcp');
  });

  it('generates a Claude Desktop config using COLLABPRO_BASE_URL and npx tsx (not ts-node, which is not an installed dependency)', async () => {
    const { default: McpSettingsHub } = await import('@/app/(routes)/dashboard/settings/mcp/page');
    render(React.createElement(McpSettingsHub));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/api-keys'));
    screen.getByText('Claude Desktop').click();

    // Rendered through CodeBlock (Prism), which wraps each JSON token in its
    // own <span> - a plain text-node regex match would land on the
    // innermost matching span ("mcpServers" alone) instead of the full
    // snippet, so match the containing <code> element specifically.
    const configBlock = await screen.findByText(
      (_, element) => element?.tagName.toLowerCase() === 'code' && !!element.textContent?.includes('mcpServers')
    );
    expect(configBlock.textContent).toContain('"COLLABPRO_BASE_URL"');
    expect(configBlock.textContent).toContain('"COLLABPRO_API_KEY"');
    expect(configBlock.textContent).not.toContain('"COLLABPRO_URL"');
    expect(configBlock.textContent).toContain('"tsx"');
    expect(configBlock.textContent).not.toContain('ts-node');
  });

  it('generates a Cursor IDE env block using COLLABPRO_BASE_URL', async () => {
    const { default: McpSettingsHub } = await import('@/app/(routes)/dashboard/settings/mcp/page');
    render(React.createElement(McpSettingsHub));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/api-keys'));

    screen.getByText('Cursor IDE').click();

    // Same CodeBlock/Prism token-splitting as above - match the <code>
    // element itself rather than an inner token span.
    const envBlock = await screen.findByText(
      (_, element) => element?.tagName.toLowerCase() === 'code' && !!element.textContent?.includes('COLLABPRO_API_KEY=')
    );
    expect(envBlock.textContent).toContain('COLLABPRO_BASE_URL=');
    expect(envBlock.textContent).not.toMatch(/COLLABPRO_URL=/);

    const cmdBlock = await screen.findByText(/npx tsx/);
    expect(cmdBlock.textContent).not.toContain('ts-node');
  });

  it('"Run Diagnostics" makes a real call to /api/mcp and shows the real returned tools, not a fabricated success', async () => {
    const { default: McpSettingsHub } = await import('@/app/(routes)/dashboard/settings/mcp/page');
    render(React.createElement(McpSettingsHub));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/api-keys'));

    // The list endpoint never returns a raw key, so nothing auto-fills the
    // bearer token - the user pastes their real key into the input first.
    fireEvent.change(screen.getByPlaceholderText('YOUR_API_KEY_HERE'), {
      target: { value: 'collabpro_pat_abc123xyz' },
    });

    screen.getByText('Run Diagnostics').click();

    // Regression: the SDK's Streamable HTTP transport 406s any request whose
    // Accept header doesn't declare both media types (see mcp-route.test.ts
    // "should reject requests missing the required Streamable HTTP Accept
    // header") - a real browser fetch's default Accept doesn't satisfy that,
    // so this button 406'd on every real click until Accept was added here.
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/mcp', expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer collabpro_pat_abc123xyz',
        Accept: 'application/json, text/event-stream',
      }),
    })));

    // Real tool name from the mocked response, not the fabricated
    // collabpro_read_board/collabpro_write_board/collabpro_create_file
    // names the old hard-coded version always displayed regardless of
    // what the real server implements. Scoped to the diagnostics console
    // specifically (not just "somewhere on the page") since the page also
    // has a static Available Tools reference card listing every real tool
    // name, collabpro_list_files included.
    const consoleEl = screen.getByTestId('mcp-diagnostics-console');
    await within(consoleEl).findByText(/collabpro_list_files/);
    expect(within(consoleEl).queryByText(/collabpro_read_board/)).toBeNull();
    expect(within(consoleEl).queryByText(/collabpro_write_board/)).toBeNull();
  });

  it('"Run Diagnostics" shows a real failure when the API call fails, not a fabricated success', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url === '/api/api-keys') {
        return {
          ok: true,
          json: async () => ({ apiKeys: [{ id: 'key-1', name: 'My Key', maskedKey: 'collabpro_pat_••••xyz123' }] }),
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
    fireEvent.change(screen.getByPlaceholderText('YOUR_API_KEY_HERE'), {
      target: { value: 'collabpro_pat_abc123xyz' },
    });
    screen.getByText('Run Diagnostics').click();

    await screen.findByText(/Forbidden/);
  });
});
