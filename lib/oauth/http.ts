import { getBaseUrl } from '@/lib/oauth/core';

/** Largest form/JSON body any OAuth endpoint reads. Real requests are well under 2 KB. */
export const MAX_OAUTH_BODY_BYTES = 8 * 1024;

export const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
} as const;

/** Reads a request body as text, refusing anything over the cap without buffering it all. */
export async function readBodyCapped(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_OAUTH_BODY_BYTES) return null;
  const text = await request.text();
  return Buffer.byteLength(text) > MAX_OAUTH_BODY_BYTES ? null : text;
}

/**
 * Parses application/x-www-form-urlencoded and rejects repeated parameters
 * (RFC 6749 3.2: parameters MUST NOT appear more than once).
 */
export function parseForm(body: string): URLSearchParams | null {
  const params = new URLSearchParams(body);
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (seen.has(key)) return null;
    seen.add(key);
  }
  return params;
}

/** Defense in depth for cookie-authenticated state changes: browser-set Origin (or Sec-Fetch-Site) must be our own origin. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin) return origin === getBaseUrl(request);
  return request.headers.get('sec-fetch-site') === 'same-origin';
}
