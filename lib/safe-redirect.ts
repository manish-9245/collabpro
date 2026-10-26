/**
 * Resolves a user-supplied post-login destination to a same-origin path.
 * Parsing with the URL class (instead of pattern-matching the raw string)
 * matters: browsers strip tab/newline characters while parsing, so a value
 * like "/\n/evil.com" passes a "starts with a single slash" regex yet
 * navigates to //evil.com. Anything that does not parse to our own origin
 * falls back, and only the parsed path/query/hash is ever returned.
 */
export function safeRedirectPath(requested: string | null | undefined, origin: string, fallback = '/dashboard'): string {
  if (!requested) return fallback;
  let url: URL;
  try {
    url = new URL(requested, origin);
  } catch {
    return fallback;
  }
  if (url.origin !== origin) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
