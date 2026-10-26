import { getBaseUrl } from '@/lib/oauth/core';

/** Largest form/JSON body any OAuth endpoint reads. Real requests are well under 2 KB. */
export const MAX_OAUTH_BODY_BYTES = 8 * 1024;

export const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
} as const;

/**
 * Reads a request body as text while counting bytes as they stream in, and
 * stops (cancelling the stream) the moment the cap is exceeded - so an
 * oversized body is never fully buffered. Returns null when over the cap or
 * when the stream fails (e.g. client disconnects mid-upload).
 */
export async function readBodyCapped(request: Request, maxBytes: number = MAX_OAUTH_BODY_BYTES): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Exact media-type match (parameters like charset allowed): `application/json-malformed` does NOT match `application/json`. */
export function hasMediaType(request: Request, expected: string): boolean {
  const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  return type === expected;
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

/**
 * Defense in depth for cookie-authenticated state changes: the browser-set Origin must be our own origin.
 * /oauth/* pages are served with `Referrer-Policy: no-referrer` (next.config.mjs), which makes browsers send
 * `Origin: null` on the consent form POST, so a "null" Origin falls back to Sec-Fetch-Site (set by the browser,
 * not forgeable by pages). No Referer fallback: no-referrer means none is sent.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null') return origin === getBaseUrl(request);
  return request.headers.get('sec-fetch-site') === 'same-origin';
}
