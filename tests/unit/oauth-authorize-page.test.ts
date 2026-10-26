import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const redirectMock = vi.hoisted(() => vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); }));
const sessionUser = vi.hoisted(() => ({ value: null as null | { email: string } }));
const validate = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  team: { findMany: vi.fn() },
  teamMember: { findMany: vi.fn() },
}));

vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: 'app.example.com', 'x-forwarded-proto': 'https' }) }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/session-auth/server', () => ({ getServerSession: () => ({ getUser: async () => sessionUser.value }) }));
vi.mock('@/lib/oauth/authorize-request', () => ({ validateAuthorizeRequest: validate }));

import AuthorizePage from '@/app/oauth/authorize/page';

beforeAll(() => { process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-1234'; });

const base = {
  clientId: 'c1', clientName: 'Claude', redirectUri: 'https://claude.ai/api/mcp/auth_callback',
  codeChallenge: 'a'.repeat(43), state: 'st', scope: 'mcp:read mcp:write',
};
const render = async (params: Record<string, string | string[] | undefined> = { client_id: 'c1' }) =>
  renderToStaticMarkup(await AuthorizePage({ searchParams: Promise.resolve(params) }));

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.OAUTH_DISABLED;
  sessionUser.value = { email: 'u@x.co' };
  validate.mockResolvedValue(base);
  prismaMock.team.findMany.mockResolvedValue([{ id: 't1', teamName: 'Core' }]);
  prismaMock.teamMember.findMany.mockResolvedValue([{ teamId: 't2' }]);
});

describe('/oauth/authorize page', () => {
  it('sends a signed-out user to login and brings them back to the same authorize URL', async () => {
    sessionUser.value = null;
    await expect(render({ client_id: 'c1', state: 'a b', scope: ['x', 'y'] })).rejects.toThrow(/NEXT_REDIRECT:\/login\?post_login_redirect_url=/);
    const url = decodeURIComponent(redirectMock.mock.calls[0][0].split('post_login_redirect_url=')[1]);
    expect(url.startsWith('/oauth/authorize?')).toBe(true);
    expect(url).toContain('client_id=c1');
    expect(url).toContain('state=a+b');
    expect(validate).not.toHaveBeenCalled();
  });

  it('shows an error card (never a redirect) for an invalid request', async () => {
    validate.mockResolvedValue({ error: 'redirect_uri is not registered for this client.' });
    const html = await render();
    expect(html).toContain("Can&#x27;t connect this app");
    expect(html).toContain('redirect_uri is not registered');
    expect(html).not.toContain('<form');
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('is disabled by OAUTH_DISABLED', async () => {
    process.env.OAUTH_DISABLED = 'true';
    expect(await render()).toContain('temporarily disabled');
  });

  it('renders the consent form: client, signed-in user, teams, opt-in write box, token bound to this request', async () => {
    prismaMock.team.findMany
      .mockResolvedValueOnce([{ id: 't1', teamName: 'Core' }])           // created teams
      .mockResolvedValueOnce([{ id: 't2', teamName: 'Platform' }]);      // member teams
    const html = await render();
    expect(html).toContain('Connect Claude to CollabPro');
    expect(html).toContain('u@x.co');
    expect(html).toContain('claude.ai');
    expect(html).toContain('Core, Platform');
    expect(html).toContain('name="allow_write"');
    expect(html).not.toMatch(/name="allow_write"[^>]*checked/); // write is OFF by default
    expect(html).toMatch(/name="consent_token" value="\d+\.[A-Za-z0-9_-]+"/);
    expect(html).toContain('action="/api/oauth/authorize"');
    expect(html).not.toContain('on your own computer'); // hosted callback: no loopback warning
  });

  it('only offers the write box when the app asked for write scope', async () => {
    validate.mockResolvedValue({ ...base, scope: 'mcp:read' });
    expect(await render()).not.toContain('allow_write');
  });

  it('warns that a loopback client is an unverified app on the user\'s computer', async () => {
    validate.mockResolvedValue({ ...base, clientName: 'Claude Code', redirectUri: 'http://localhost:51111/callback' });
    const html = await render();
    expect(html).toContain('on your own computer');
    expect(html).toContain('not verified');
  });

  it('escapes a hostile client name', async () => {
    validate.mockResolvedValue({ ...base, clientName: '<script>alert(1)</script>' });
    const html = await render();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('falls back to a generic teams line when the user has none', async () => {
    prismaMock.team.findMany.mockResolvedValue([]);
    prismaMock.teamMember.findMany.mockResolvedValue([]);
    expect(await render()).toContain('your teams');
  });
});
