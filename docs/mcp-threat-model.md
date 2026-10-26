# MCP threat model: prompt injection and write scopes

CollabPro's MCP server lets an AI app read and write user content. The content itself is attacker-influenceable (shared files, pasted text), and a model reading it may act on instructions hidden inside. This documents what we assume, what we enforce, and what we deliberately leave to the user.

## Assets
- Document and whiteboard content in a user's teams.
- The user's ability to write/overwrite that content.
- Their OAuth grant / API key.

## Threats and mitigations

| # | Threat | Mitigation | Where |
|---|---|---|---|
| 1 | A malicious/shared file contains instructions ("delete the board", "send this elsewhere") that steer the connected model | Writes are **opt-in at consent** (unticked by default; read-only grant cannot write). Tools can only touch files in the caller's own teams. `update_document`/`replaceAll` are annotated `destructiveHint: true` so clients can confirm. The plugin skill tells the model to treat file content as data | `app/oauth/authorize`, `lib/mcp/tools.ts`, `plugins/collabpro/skills` |
| 2 | Cross-team access through a tool argument (`fileId`, `teamId`) — BOLA | Every file tool resolves the file through `getAuthorizedFile` (creator-or-member team union); `create_file`/`search`/`list_files` intersect `teamId` with the caller's teams. OAuth tokens carry the same identity as keys, so the same checks apply | `lib/mcp/tools.ts`, `tests/unit/mcp-connector.test.ts` |
| 3 | Lost update: an agent overwrites a human's concurrent edit | Compare-and-swap writers + opt-in `baseVersion` (`documentVersion`/`whiteboardVersion` from `get_file`) → `Conflict` | `lib/cas-writes.ts`, `lib/mcp/tools.ts` |
| 4 | Data exfiltration through tool arguments (model puts file content into a URL/arg) | No tool makes outbound requests with caller-supplied hosts. Icon fetches only hit the fixed `excalidraw-libraries` repo with a validated `author/name.excalidrawlib` path. Exports return text to the caller only | `lib/mcp/icon-libraries.ts`, `lib/mcp/export.ts` |
| 5 | Stored XSS via exported HTML | `documentToHtml` strips inline tags, escapes all text, only emits `http(s)` image URLs | `lib/mcp/export.ts`, `tests/unit/mcp-export.test.ts` |
| 6 | Stolen/replayed OAuth credentials | Hashed storage; single-use 60 s codes with PKCE S256; 1 h access tokens; refresh rotation with reuse detection (replay revokes the whole grant); audience-bound to `/api/mcp`; revocable in Settings | `lib/oauth/*`, `tests/unit/oauth-*.test.ts` |
| 7 | Consent phishing / clickjacking / CSRF on the Allow button | Redirect URIs allowlisted at registration (Claude callback + loopback only); `X-Frame-Options: DENY` + `frame-ancestors 'none'` on `/oauth/*`; same-origin check + HMAC consent token bound to user, client, redirect, PKCE challenge and scope; redirect host displayed | `lib/oauth/core.ts`, `next.config.mjs` |
| 8 | Open redirect after login | `post_login_redirect_url` accepted only as a same-site path (`/…`, not `//` or `/\`) | `app/login/page.tsx` |
| 9 | Resource exhaustion (huge writes, DCR spam, tight loops) | 5 MB body cap, 120 req/min per credential, element/node caps (500 / 60), DCR + token IP rate limits, expired-row cleanup | `app/api/mcp/route.ts`, `lib/rate-limiter.ts` |
| 10 | Runaway/abusive agent in production | Kill switches: `MCP_DISABLED`, `MCP_READ_ONLY`, `MCP_DISABLED_TOOLS`, `OAUTH_DISABLED`; every write audit-logged with the OAuth client id | `lib/mcp/kill-switch.ts` |
| 11 | Server-side AI spending a team's key | AI tool exists only if the team configured a provider; model returns a bounded JSON spec (≤60 nodes), validated before any write | `lib/mcp/ai-spec.ts` |

## Explicitly out of scope (residual risk)
- A model can still be persuaded to make **legitimate-looking writes within the granted scope** (e.g. add misleading nodes). Mitigation is the opt-in write grant, the audit log, version history/checkpoints, and revocation — not content filtering.
- Per-tool user confirmation is the client's job (Claude prompts on `destructiveHint`).
- No per-team allow-list on a token yet: a grant covers all teams the user belongs to (the consent screen lists them).

## Review checklist before enabling for customers
- [ ] Independent review of `lib/oauth/*` and the consent flow.
- [ ] Verify `SESSION_SECRET` is set (consent tokens are HMAC'd with it).
- [ ] `APP_URL` set if behind a proxy; `/.well-known/*` reachable externally.
- [ ] Alerting from `docs/runbooks/mcp.md` live.
