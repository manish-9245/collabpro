"use client"

import React, { useCallback, useEffect, useState } from 'react';
import { Plug, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface Grant {
  clientId: string;
  clientName: string;
  scope: string;
  connectedAt: string;
  lastUsedAt: string | null;
}

// Apps (e.g. Claude) a user has authorized through OAuth. Revoking kills the
// access and refresh tokens immediately; the app must be re-authorized.
export default function ConnectedApps() {
  const [grants, setGrants] = useState<Grant[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/oauth/grants');
      setGrants(res.ok ? (await res.json()).grants : []);
    } catch {
      setGrants([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const revoke = async (clientId: string) => {
    const res = await fetch(`/api/oauth/grants?clientId=${encodeURIComponent(clientId)}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('Access revoked');
      load();
    } else {
      toast.error('Could not revoke access');
    }
  };

  return (
    <div data-testid="connected-apps" className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5">
      <div className="flex items-center gap-2 text-sm font-black">
        <Plug className="h-4 w-4 text-[#6965db]" /> Connected apps
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Apps you signed in to CollabPro with (for example Claude). Revoke any you no longer use.</p>
      <div className="mt-3 space-y-2">
        {grants === null && <div className="text-[11px] text-slate-400">Loading…</div>}
        {grants?.length === 0 && <div className="text-[11px] text-slate-400 italic">No connected apps yet.</div>}
        {grants?.map((g) => (
          <div key={g.clientId} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 dark:border-slate-800 px-3 py-2">
            <div className="min-w-0">
              <div className="text-xs font-bold truncate">{g.clientName}</div>
              <div className="text-[10px] text-slate-500">
                {g.scope.includes('mcp:write') ? 'Read & write' : 'Read only'} · connected {new Date(g.connectedAt).toLocaleDateString()}
                {g.lastUsedAt ? ` · last used ${new Date(g.lastUsedAt).toLocaleDateString()}` : ''}
              </div>
            </div>
            <button
              type="button"
              onClick={() => revoke(g.clientId)}
              className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950 text-[10px] font-bold cursor-pointer"
            >
              <Trash2 className="h-3 w-3" /> Revoke
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
