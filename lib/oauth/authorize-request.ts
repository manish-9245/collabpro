import type { PrismaClient } from '@prisma/client';
import { isValidCodeChallenge, normalizeScope, redirectUriMatches } from '@/lib/oauth/core';
import { getClient } from '@/lib/oauth/store';

export interface ValidAuthorizeRequest {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scope: string;
}

/**
 * Validates /oauth/authorize parameters. Failures are never redirected back
 * to the (unverified) redirect_uri - the caller renders an error page - so a
 * crafted link cannot bounce a user to an attacker-chosen location.
 */
export async function validateAuthorizeRequest(
  prisma: PrismaClient,
  params: Record<string, string | undefined>,
): Promise<ValidAuthorizeRequest | { error: string }> {
  if (params.response_type !== 'code') return { error: 'response_type must be "code".' };
  if (!params.client_id) return { error: 'Missing client_id.' };
  const client = await getClient(prisma, params.client_id);
  if (!client) return { error: 'Unknown client. Remove and re-add the connector in your AI app.' };
  if (!params.redirect_uri || !redirectUriMatches(client.redirectUris, params.redirect_uri)) {
    return { error: 'redirect_uri is not registered for this client.' };
  }
  if (params.code_challenge_method !== 'S256' || !params.code_challenge || !isValidCodeChallenge(params.code_challenge)) {
    return { error: 'PKCE with code_challenge_method=S256 is required.' };
  }
  return {
    clientId: client.clientId,
    clientName: client.clientName,
    redirectUri: params.redirect_uri,
    codeChallenge: params.code_challenge,
    state: params.state ?? '',
    scope: normalizeScope(params.scope),
  };
}
