import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { getServerSession } from '@/lib/session-auth/server';
import { consentToken, getBaseUrl, isLoopbackRedirect, SCOPE_WRITE } from '@/lib/oauth/core';
import { validateAuthorizeRequest } from '@/lib/oauth/authorize-request';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function ErrorCard({ message }: Readonly<{ message: string }>) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-lg font-bold text-slate-900">Can&apos;t connect this app</h1>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
      </div>
    </main>
  );
}

export default async function AuthorizePage({ searchParams }: Readonly<{ searchParams: Promise<SearchParams> }>) {
  if (process.env.OAUTH_DISABLED === 'true') return <ErrorCard message="Connecting apps is temporarily disabled." />;

  const raw = await searchParams;
  const params: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) params[k] = first(v);

  const user = await getServerSession().getUser();
  if (!user?.email) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, v);
    const back = `/oauth/authorize?${qs.toString()}`;
    redirect(`/login?post_login_redirect_url=${encodeURIComponent(back)}`);
  }

  const h = await headers();
  // Same derivation as /api/oauth/token and /api/oauth/authorize, so the
  // resource check cannot disagree between consent and token exchange.
  const base = getBaseUrl(new Request(`http://${h.get('host') ?? 'localhost'}/`, { headers: h }));
  const req = await validateAuthorizeRequest(prisma, params, base);
  if ('error' in req) return <ErrorCard message={req.error} />;

  const [created, memberships] = await Promise.all([
    prisma.team.findMany({ where: { createdBy: user.email }, select: { id: true, teamName: true } }),
    prisma.teamMember.findMany({ where: { userEmail: user.email }, select: { teamId: true } }),
  ]);
  const memberTeamIds = memberships.map((m) => m.teamId).filter(Boolean) as string[];
  const memberTeams = memberTeamIds.length
    ? await prisma.team.findMany({ where: { id: { in: memberTeamIds } }, select: { id: true, teamName: true } })
    : [];
  const teams = Array.from(new Map([...created, ...memberTeams].map((t) => [t.id, t.teamName])).values());

  const token = consentToken({
    userEmail: user.email,
    clientId: req.clientId,
    redirectUri: req.redirectUri,
    codeChallenge: req.codeChallenge,
    state: req.state,
    scope: req.scope,
  });
  const wantsWrite = req.scope.split(' ').includes(SCOPE_WRITE);
  const isLocalApp = isLoopbackRedirect(req.redirectUri);
  let redirectHost = req.redirectUri;
  try {
    redirectHost = new URL(req.redirectUri).host;
  } catch {}

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <form method="post" action="/api/oauth/authorize" className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm space-y-5">
        <input type="hidden" name="client_id" value={req.clientId} />
        <input type="hidden" name="redirect_uri" value={req.redirectUri} />
        <input type="hidden" name="code_challenge" value={req.codeChallenge} />
        <input type="hidden" name="state" value={req.state} />
        <input type="hidden" name="scope" value={req.scope} />
        <input type="hidden" name="consent_token" value={token} />

        <div>
          <h1 className="text-lg font-bold text-slate-900">Connect {req.clientName} to CollabPro</h1>
          <p className="mt-1 text-sm text-slate-600">
            Signed in as <span className="font-medium">{user.email}</span>. After approval, you&apos;ll be sent back to{' '}
            <span className="font-mono text-xs">{redirectHost}</span>.
          </p>
        </div>

        {isLocalApp && (
          <div role="alert" className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
            This app runs <span className="font-semibold">on your own computer</span> (it redirects to localhost). Its name is chosen by the app itself and is not verified. Only continue if you just started a tool such as Claude Code yourself.
          </div>
        )}

        <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-sm text-slate-700 space-y-2">
          <p className="font-medium text-slate-900">This app will be able to:</p>
          <p>• Read files, documents and whiteboards in: <span className="font-medium">{teams.length ? teams.join(', ') : 'your teams'}</span></p>
          {wantsWrite && (
            <label className="flex items-start gap-2">
              <input type="checkbox" name="allow_write" value="1" className="mt-1" />
              <span>Also <span className="font-medium">create and edit</span> files in those teams (off by default)</span>
            </label>
          )}
        </div>

        <p className="text-xs text-slate-500">
          Only approve apps you trust. Content in your files is visible to the AI app and may influence what it does. You can revoke access
          anytime in Settings → MCP.
        </p>

        <div className="flex gap-3">
          <button type="submit" name="decision" value="allow" className="flex-1 rounded-lg bg-slate-900 text-white text-sm font-semibold py-2.5">Allow</button>
          <button type="submit" name="decision" value="deny" className="flex-1 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold py-2.5">Deny</button>
        </div>
      </form>
    </main>
  );
}
