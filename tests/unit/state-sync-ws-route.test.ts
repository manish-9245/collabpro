import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

const nav = vi.hoisted(() => ({ pathname: '/dashboard' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(public url: string) { FakeWebSocket.instances.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
}

async function freshClient(startPath = '/dashboard') {
  vi.resetModules();
  window.history.pushState({}, '', startPath);
  const mod = await import('@/lib/state-sync/react');
  return mod;
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  nav.pathname = '/dashboard';
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ token: 'sess-token' }) })));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.pushState({}, '', '/');
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('workspaceFileIdFromPath', () => {
  it('extracts the file id only from workspace routes', async () => {
    const { workspaceFileIdFromPath } = await freshClient();
    expect(workspaceFileIdFromPath('/workspace/abc-123')).toBe('abc-123');
    expect(workspaceFileIdFromPath('/workspace/abc-123/settings')).toBe('abc-123');
    expect(workspaceFileIdFromPath('/dashboard')).toBeNull();
    expect(workspaceFileIdFromPath('/')).toBeNull();
    expect(workspaceFileIdFromPath(null)).toBeNull();
    expect(workspaceFileIdFromPath(undefined)).toBeNull();
  });
});

describe('wsClient follows client-side navigation (the dashboard -> file bug)', () => {
  it('does not connect on a non-workspace page load', async () => {
    await freshClient('/dashboard');
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('entering a workspace connects with the session token and joins that room on open', async () => {
    const { wsClient } = await freshClient('/dashboard');
    wsClient!.setActiveRoom('file-1');
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toContain('token=sess-token');
    FakeWebSocket.instances[0].open();
    expect(FakeWebSocket.instances[0].sent).toContainEqual({ type: 'join', fileId: 'file-1' });
  });

  it('the same room twice does not open a second socket', async () => {
    const { wsClient } = await freshClient('/dashboard');
    wsClient!.setActiveRoom('file-1');
    wsClient!.setActiveRoom('file-1');
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('switching files while connected joins the new room on the SAME socket', async () => {
    const { wsClient } = await freshClient('/dashboard');
    wsClient!.setActiveRoom('file-1');
    await flush();
    FakeWebSocket.instances[0].open();
    wsClient!.setActiveRoom('file-2');
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].sent).toContainEqual({ type: 'join', fileId: 'file-2' });
  });

  it('leaving the workspace keeps the socket and sends nothing; re-entering joins again', async () => {
    const { wsClient } = await freshClient('/dashboard');
    wsClient!.setActiveRoom('file-1');
    await flush();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    const sentBefore = ws.sent.length;
    wsClient!.setActiveRoom(null);
    expect(ws.sent).toHaveLength(sentBefore);
    expect(ws.readyState).toBe(FakeWebSocket.OPEN);
    wsClient!.setActiveRoom('file-1');
    expect(ws.sent.filter((m) => m.type === 'join')).toHaveLength(2);
  });

  it('a page loaded directly on a workspace URL still connects immediately (unchanged behavior)', async () => {
    await freshClient('/workspace/direct-file');
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('StateSyncProvider', () => {
  it('feeds the current route into wsClient on mount and on every navigation', async () => {
    const { StateSyncProvider, wsClient } = await freshClient('/dashboard');
    const spy = vi.spyOn(wsClient!, 'setActiveRoom');
    const tree = () => React.createElement(StateSyncProvider, null, React.createElement('div', null, 'child'));
    const { rerender, getByText } = render(tree());
    expect(getByText('child')).toBeTruthy();
    expect(spy).toHaveBeenLastCalledWith(null);

    nav.pathname = '/workspace/file-9';
    rerender(tree());
    expect(spy).toHaveBeenLastCalledWith('file-9');

    nav.pathname = '/dashboard';
    rerender(tree());
    expect(spy).toHaveBeenLastCalledWith(null);
  });
});
