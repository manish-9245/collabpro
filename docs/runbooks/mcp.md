# Runbook: MCP server and OAuth

## What runs where
`/api/mcp` (tools), `/api/oauth/*` + `/oauth/authorize` (sign-in), `/.well-known/oauth-*` (discovery). All in the Next.js service; state in Postgres (`OAuthClient`, `OAuthCode`, `OAuthToken`), rate limits in Redis (in-memory fallback).

## SLOs (starting targets — tune after a week of data)
| SLI | Target | Why |
|---|---|---|
| `/.well-known/*` and `/api/oauth/token` p95 | < 1 s (hard limit from Claude: 10 s; 30 s for refresh) | Claude gives up and shows "Couldn't reach the MCP server" |
| `/api/mcp` availability (non-5xx) | 99.9 % | |
| `/api/mcp` p95 for non-AI tools | < 2 s | tool-call budget is 240 s but UX degrades well before |
| Token endpoint `invalid_grant` ratio | < 5 % of calls | spike = clock skew, broken rotation, or token theft |

Signals already emitted: `mcp_request` structured log line (user, method, tool, status, durationMs, oauthClientId); audit actions `mcp:*`, `oauth:consent:granted|denied`, `oauth:grant:revoked`, `oauth:token:failure`, `mcp:rate_limited`, `mcp:auth:failure`.

## Alerts to create (Railway / log drain)
1. 5xx rate on `/api/mcp` or `/api/oauth/*` > 2 % for 5 min.
2. p95 of `durationMs` for `mcp_request` > 2000 ms for 10 min; any `/api/oauth/token` p95 > 3 s.
3. `oauth:token:failure` > 50 / 10 min (possible replay/stuffing).
4. `mcp:rate_limited` sustained > 20 / 10 min from one user.
5. Synthetic check every minute: `GET /.well-known/oauth-protected-resource` returns 200 and `resource` ends with `/api/mcp`; `POST /api/mcp` without auth returns 401 with `WWW-Authenticate`.

## Deploy checklist
- `npx prisma migrate deploy` ran (`20261026000000_add_oauth_server`). **Verify in prod** — a missing migration makes consent/token fail with 500: `select count(*) from "OAuthClient";`.
- `SESSION_SECRET` set; **`APP_URL` set to the public https origin** (pins OAuth issuer/metadata and enables caching of discovery documents).
- `npm run verify-pipelines` green (CI + Railway).
- Set `CRON_SECRET` (24+ characters; the app also runs an hourly in-process cleanup as a fallback) and schedule a daily cron: `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/internal/oauth-cleanup` (runs inside the app image; the `npm run oauth:cleanup` script needs a source checkout + `tsx`, which the production image does not ship).
- Smoke: `BASE_URL=https://<app> COLLABPRO_API_KEY=<test-key> npm run mcp:loadtest -- --seconds 20` (add `--token-probe` to also exercise `/api/oauth/token`: opt-in because that endpoint is rate limited per IP and each failed grant writes an audit row; without `BASE_URL` it targets localhost; without a key it skips the authenticated `tools/list` probe).

## Incidents
| Symptom | Action |
|---|---|
| MCP misbehaving / suspected abuse | Set `MCP_READ_ONLY=true` (keeps reads) or `MCP_DISABLED=true`, restart. |
| One tool misbehaving | `MCP_DISABLED_TOOLS=collabpro_<tool>` |
| OAuth flow broken, API keys fine | `OAUTH_DISABLED=true` (discovery 404s, OAuth tokens rejected; keys unaffected) |
| Suspected token theft for a user | User: Settings → MCP → Connected apps → Revoke. Operator: `update "OAuthToken" set "revokedAt"=now() where "userEmail"='…';` |
| Claude: "Couldn't reach the MCP server" | `curl -i <url>/api/mcp -X POST -d '{}'` → expect 401 + `WWW-Authenticate`. Then `curl <url>/.well-known/oauth-protected-resource` → `resource` must equal the pasted URL. Check WAF allows `160.79.104.0/21`. |
| Claude: "Authorization failed" | Check logs for `oauth:token:failure` reason; confirm the token endpoint isn't returning JSON-only parsing errors (must accept form-encoded). |
| Table growth | Call the cleanup endpoint (see Deploy checklist); DCR clients with no tokens are pruned after 24 h. |

## Rollback
Disable with env vars above (instant after restart). The migration is additive (3 new tables); rolling the app back without dropping them is safe.
