import { prisma } from '@/lib/db';
import { getServerSession } from '@/lib/session-auth/server';
import { checkRateLimit, LIMITS } from '@/lib/rate-limiter';
import { decryptSecret } from '@/lib/crypto-secrets';
import { isKnownProvider, fetchProviderModels } from '@/lib/ai-providers';

/**
 * Dynamic model listing for AI Co-Pilot Setup (settings/ai/page.tsx's
 * "Fetch available models" button). Proxies the request server-side so the
 * apiKey - whether freshly typed or the team's already-saved one - never
 * needs to round-trip through another client. Owner-only, same as
 * ai:saveSettings in aiSettingsService.ts (this is a configuration action,
 * not a read of already-saved settings).
 */
export async function POST(request: Request): Promise<Response> {
  const user = await getServerSession().getUser();
  if (!user?.email) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const rateLimit = await checkRateLimit(`ai_models:${user.email}`, LIMITS.AI_MODELS);
  if (!rateLimit.allowed) {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { teamId, provider, baseUrl } = body || {};
  let apiKey: string | undefined = body?.apiKey;

  if (typeof teamId !== 'string' || !teamId || typeof provider !== 'string' || !isKnownProvider(provider)) {
    return Response.json({ error: 'bad_request', message: 'teamId and a known provider are required' }, { status: 400 });
  }
  if (provider === 'custom' && typeof baseUrl !== 'string') {
    return Response.json({ error: 'bad_request', message: 'baseUrl is required for a custom provider' }, { status: 400 });
  }

  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team || team.createdBy !== user.email) {
    return Response.json({ error: 'forbidden', message: 'Only the team owner can browse models' }, { status: 403 });
  }

  // Blank apiKey means "use the already-saved key" - lets the owner refresh
  // the model list without retyping a secret they've already stored.
  if (!apiKey) {
    const existing = await prisma.teamAiSettings.findUnique({ where: { teamId } });
    if (!existing) {
      return Response.json({ error: 'no_api_key', message: 'Enter an API key first' }, { status: 400 });
    }
    apiKey = decryptSecret(existing.encryptedKey);
  }

  try {
    const models = await fetchProviderModels(provider, baseUrl || '', apiKey);
    return Response.json({ models: models.sort() });
  } catch (err) {
    return Response.json(
      { error: 'provider_request_failed', message: err instanceof Error ? err.message : 'Failed to reach the provider' },
      { status: 502 }
    );
  }
}
