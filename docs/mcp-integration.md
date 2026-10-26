# MCP Integration

CollabPro exposes a [Model Context Protocol](https://modelcontextprotocol.io) server so AI agents (Claude, Cursor, Windsurf, or any custom MCP client) can list, read, and edit your files and whiteboards.

## Architecture

There is exactly one real MCP server, one tool registry, and one prompt registry:

- **`lib/mcp/tools.ts`** — the canonical tool definitions (Zod schemas + handlers). This is the single source of truth; nothing else defines tools.
- **`lib/mcp/prompts.ts`** — the canonical [MCP prompts](https://modelcontextprotocol.io/specification/2025-06-18/server/prompts) (currently one: `collabpro_diagram_guidelines`) — reusable instructions a client fetches and injects into its own context *before* generating, as opposed to a tool description it only reads at call time.
- **`lib/mcp/icon-libraries.ts`** — fetches and translates items from the community Excalidraw icon libraries (AWS/Azure/GCP/network/UML/BPMN/etc.) for the two `collabpro_*_icon_libraries` tools below.
- **`app/api/mcp/route.ts`** — the real server. A spec-compliant [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) transport built on the official [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk), reachable directly at `<your-app-url>/api/mcp`.
- **`scripts/mcp-server.ts`** — a thin stdio↔HTTP bridge, for clients that only support locally-spawned stdio servers. It defines no tools or business logic of its own — every message it receives over stdio is forwarded verbatim to `/api/mcp` and the response forwarded back. There is nothing here to drift out of sync with the real server.

```
MCP Client (remote-capable)  ──HTTP──▶  app/api/mcp/route.ts  ──▶  lib/mcp/tools.ts  ──▶  Prisma / CAS writes
MCP Client (stdio-only)  ──stdio──▶  scripts/mcp-server.ts  ──HTTP──▶  app/api/mcp/route.ts  ──▶  (same as above)
```

Authentication happens in `app/api/mcp/route.ts`, outside the SDK, using the same API-key middleware (`lib/api-key-middleware.ts`) as every other API-key-gated route in the app. The SDK only owns JSON-RPC/transport mechanics once a request is already known to belong to an authorized user.

## Setup

Generate an API key first: **Settings → API Keys**. Then go to **Settings → MCP** for a UI that generates ready-to-paste config for each option below, using your selected key.

### Option A — Remote (recommended, no install)

Any client that supports remote MCP servers (Streamable HTTP) can connect directly:

- **Server URL**: `<your-app-url>/api/mcp`
- **Authorization header**: `Bearer <your-api-key>`

No local process, no runtime to install.

**VS Code**: has native MCP client support (Copilot Chat's agent mode) and speaks Streamable HTTP directly — no bridge needed. A ready-to-use `.vscode/mcp.json` ships in this repo; opening the workspace and starting the `collabpro` server (via the "MCP: List Servers" command, or the ▷ affordance VS Code shows above the server in that file) prompts once for your API key and connects straight to `/api/mcp`.

### Option B — stdio bridge (Claude Desktop, Cursor, Windsurf, or any stdio-only client)

Launch `scripts/mcp-server.ts` with `npx tsx` (already a project devDependency — no extra install), pointed at your CollabPro instance:

```json
{
  "mcpServers": {
    "collabpro-mcp": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/collabpro/scripts/mcp-server.ts"],
      "env": {
        "COLLABPRO_API_KEY": "<your-api-key>",
        "COLLABPRO_BASE_URL": "<your-app-url>"
      }
    }
  }
}
```

`COLLABPRO_BASE_URL` defaults to `http://localhost:3000` if unset. The bridge exits immediately with an error if `COLLABPRO_API_KEY` is missing.

### Option C — Claude (claude.ai / Desktop / mobile) custom connector

No API key needed — Claude signs the user in with OAuth 2.1:

1. In Claude: **Settings → Connectors → Add custom connector**, paste `<your-app-url>/api/mcp`.
2. Claude discovers the sign-in via a `401` + `WWW-Authenticate: Bearer resource_metadata=…` from `/api/mcp`, registers itself (Dynamic Client Registration), and sends you to CollabPro's consent page (`/oauth/authorize`).
3. Sign in to CollabPro if needed, review what the app can reach (your teams are listed), optionally tick **create and edit** (off by default), and **Allow**.
4. Revoke any time in **Settings → MCP → Connected apps**.

The instance must be reachable from the internet over HTTPS (Anthropic connects from `160.79.104.0/21`). Behind a proxy that doesn't forward `X-Forwarded-Host`/`X-Forwarded-Proto`, set `APP_URL` so discovery metadata advertises the right origin. API keys (`collabpro_pat_…`) keep working for scripts, Claude Code and the stdio bridge.

For the **Connectors Directory** see [`mcp-directory-submission.md`](mcp-directory-submission.md).

### OAuth server reference

| Endpoint | Purpose |
|---|---|
| `GET /.well-known/oauth-protected-resource` | RFC 9728 metadata; `resource` is exactly `<origin>/api/mcp` |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 metadata; S256 only, public clients (`token_endpoint_auth_methods_supported: ["none"]`) |
| `POST /api/oauth/register` | RFC 7591 DCR. Only the Claude callback `https://claude.ai/api/mcp/auth_callback` and loopback (`http://localhost\|127.0.0.1/...`, port ignored) redirect URIs are accepted. IP rate limited |
| `GET /oauth/authorize` | Consent page. Reuses the normal CollabPro login; shows the teams in scope; write is opt-in |
| `POST /api/oauth/authorize` | Consent submit. Same-origin + stateless HMAC consent token bound to user/client/redirect/PKCE/scope. `/oauth/*` is served with `Referrer-Policy: no-referrer`, so browsers send `Origin: null` on this POST; the same-origin check then relies on `Sec-Fetch-Site: same-origin` |
| `POST /api/oauth/revoke` | RFC 7009 revocation (access or refresh token). `200` for every well-formed request, known token or not (no validity oracle); `400` malformed, `429`/`503` throttled/disabled |
| `POST /api/oauth/token` | `authorization_code` and `refresh_token` grants, `application/x-www-form-urlencoded`. Access token 1 h, refresh token 30 d, rotated on every use; replaying a rotated token revokes the whole grant |
| `GET/DELETE /api/oauth/grants` | Session-authenticated "Connected apps" list / revoke |

Standards followed: OAuth 2.1 draft, RFC 9700 (security BCP), RFC 7636 (PKCE S256 only), RFC 7591 (DCR), RFC 8414 / 9728 (metadata), RFC 8707 (`resource` must be this server), RFC 9207 (`iss` on authorization responses), RFC 7009 (revocation). Token/registration/revocation inputs are capped at 8 KB, require the correct `Content-Type`, and reject repeated parameters. A reused authorization code revokes the tokens it produced; a refresh token reused after 10 s revokes the whole grant (retries inside 10 s are refused without revoking, so a double refresh can't log a user out). Discovery documents are cacheable only when `APP_URL` (or `OAUTH_ISSUER`) pins the origin, and `no-store` otherwise — **set `APP_URL` in production**. Registration (`/api/oauth/register`) accepts at most 5 redirect URIs of 512 characters; unlike the form endpoints it does not reject duplicate JSON members (last one wins), but only values that pass the allowlist are stored.

Scopes: `mcp:read` (always), `mcp:write` (only when requested **and** ticked), `offline_access`. OAuth tokens (`collabpro_oat_…`) are accepted **only** by `/api/mcp` — not by state-sync or any other API-key route. Every secret (codes, tokens) is stored as a SHA-256 hash. Housekeeping runs from a daily cron that calls `POST /api/internal/oauth-cleanup` with `Authorization: Bearer $CRON_SECRET` (disabled with `404` until `CRON_SECRET` is set); `npm run oauth:cleanup` does the same from a source checkout.

## Tools

| Tool | Description | Requires write scope |
|---|---|---|
| `collabpro_list_files` | List files/folders in scope (`org`, `team`, or `personal`), optionally filtered by `teamId`. Paginated (`limit` 1-200, default 50; pass back `nextCursor` for the next page). Returns lightweight metadata only (not the full document/whiteboard) — includes `whiteboardText`, a cheap derived label index, so a caller can tell an empty canvas from a real one without opening each file. | No |
| `collabpro_get_file` | Fetch a single file's document blocks and whiteboard elements by `fileId`. | No |
| `collabpro_create_file` | Create a new document/whiteboard file inside a team the caller belongs to. Leave `document`/`whiteboard` unset to start blank. | Yes |
| `collabpro_update_document` | Overwrite a file's document (Editor.js payload, object or JSON string) — full replace, no merge mode. | Yes |
| `collabpro_update_whiteboard` | Add/update elements on a file's whiteboard. **Merges onto the existing board by id by default** — safe to call once per node/arrow across a multi-step diagram build, since a later call never discards an earlier one's work. `deleted` (element ids) removes specific elements; `replaceAll: true` opts into the old full-replace behavior for a deliberate regenerate. Server-side layout validation — see below. | Yes |
| `collabpro_search_icon_libraries` | Keyword search over the 200+ community Excalidraw icon libraries ([libraries.excalidraw.com](https://libraries.excalidraw.com): AWS/Azure/GCP/network/UML/BPMN/etc). Returns each match's `source` string. | No |
| `collabpro_list_library_items` | List every icon in one library by name (derived from the item's own content when the library has no metadata name), so a caller can pick items deliberately instead of guessing numeric indices. | No |
| `collabpro_get_library_icon` | Fetch and place one icon from a library (`librarySource` + `item`) at `(x, y)`. Returns a short-lived `ref` — plus its footprint `width`/`height` for laying out the next icon without overlap — **not** the element geometry itself. Pass `ref` to `collabpro_update_whiteboard`'s `iconRefs` array to place it; refs are single-use and expire after 30 minutes. | No |
| `collabpro_list_teams` | List the teams you can access (`id`, `teamName`, `description`). | No |
| `collabpro_search` | Case-insensitive search across file names, document text and whiteboard labels; returns snippets. Scoped to your teams. | No |
| `collabpro_export_file` | Export as `svg` (whiteboard), `markdown`, `html` or `text` (document). Capped at ~100k characters (`truncated: true`). PNG/PDF stay in the app's Export menu. | No |
| `collabpro_place_icon` | One-step icon placement from a phrase (`"aws lambda"`): searches the libraries, picks the best vector icon, returns a `ref` for `iconRefs`. | No |
| `collabpro_apply_diagram_spec` | **Preferred way to draw.** Takes `nodes`, `edges`, optional `group`/`icon`/`direction`; the server lays out (layered, overlap-free), draws labeled boxes and bound arrows, saves. Adds below existing content unless `replaceAll`. Up to 60 nodes / 120 edges. | Yes |
| `collabpro_create_diagram` | *Only listed when a team you belong to has an AI provider configured (Settings → AI).* Plain-English → diagram. The provider (and so the key that is billed) is the one configured by **the team the diagram is created in** — the file's team, or the `teamId` you pass — never another team you happen to belong to; if that team has none the call fails with a clear error. Validated before any file is created (no orphans), then streams `notifications/progress` over SSE. | Yes |

`get_file` returns `documentVersion` / `whiteboardVersion`; `update_document`, `update_whiteboard` and `apply_diagram_spec` accept it back as `baseVersion` and reject with `Conflict` if the file changed since (opt-in optimistic concurrency, on top of the compare-and-swap writers). Every tool declares an `outputSchema` and returns `structuredContent`; file-producing tools also return a `fileUrl` / `resource_link`.


All inputs are validated by the SDK against each tool's Zod schema before the handler runs — a missing or wrong-typed required field is rejected as a tool error automatically. Access is scoped to teams the authenticated API key's user belongs to (union of teams they created and teams they're a member of); a `read-only`-scoped key gets a `Forbidden` tool error on any write tool. Writes go through the same compare-and-swap writers (`lib/cas-writes.ts`) as every other write path in the app (HTTP state-sync, the WebSocket gateway), so a concurrent human edit can't be silently clobbered. Every tool also declares [MCP annotations](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool-annotations) (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) so a well-behaved client can reason about risk (and about which tools touch the network) before calling one.

Run **tools/list** against your server to see the exact current schema — it's generated directly from the Zod definitions in `lib/mcp/tools.ts`, so it can never drift from what the tools actually accept.

### Whiteboard layout enforcement

`collabpro_update_whiteboard` rejects a write outright (no partial persist) if:

- any shape (`rectangle`/`ellipse`/`diamond`) has a non-finite `x`/`y`/`width`/`height`;
- two shapes overlap without sharing a `groupIds` entry (same-`groupIds` shapes are exempt, since a composite icon's parts are *meant* to overlap — that's how a vector icon is drawn from primitives);
- a `text` element has no non-empty `strokeColor` (the single most common way a generated diagram ships with invisible text);
- an `arrow`/`line` element has fewer than 2 `points`, or its declared `width`/`height` are both `0` while those points span a real distance (renders as nothing).

Every error names the exact offending element(s) so a caller can fix and retry. This is enforcement, not a suggestion — it applies identically no matter which AI or client is calling. The full layout/color/typography/section-header/icon-binding guidance lives in the `collabpro_diagram_guidelines` **prompt** below, not just the tool description, since a prompt is what a client is meant to pull into its own context before it starts generating.

### Icon libraries

`collabpro_search_icon_libraries` → `collabpro_list_library_items` → `collabpro_get_library_icon` chain together: search by keyword, take a result's `source`, list every real icon it contains by name, then fetch and place a specific one (by 0-based index or name substring) at a target position — pass the returned `ref` to `collabpro_update_whiteboard`'s `iconRefs`, not the element geometry (which the fetch call no longer even returns). The fetch only ever hits the fixed `excalidraw/excalidraw-libraries` GitHub repo (`librarySource` is validated against `author/name.excalidrawlib`, never a full URL — no SSRF surface), is cached in-memory for an hour (up to 8MB per library file), and rejects any item containing an `image` element (won't render through this whiteboard's export path — see `lib/mcp/icon-libraries.ts`).

## Prompts

| Prompt | Description |
|---|---|
| `collabpro_diagram_guidelines` | Layout, semantic color palette, typography, section-header placement, real arrow-to-shape bindings (`startBinding`/`endBinding`), and icon-library guidance for `collabpro_update_whiteboard`, condensed from [Agents365-ai/excalidraw-skill](https://github.com/Agents365-ai/excalidraw-skill) (MIT). Fetch via `prompts/get` before drafting a diagram. |

Prompts are a distinct MCP primitive from tools (`prompts/list`, `prompts/get`) — check your client supports them; not every MCP client surfaces prompts in its UI.

## Protocol notes

- The Streamable HTTP transport requires the `Accept: application/json, text/event-stream` request header, per spec. A request missing it gets a `406 Not Acceptable` — this is correct, not a bug.
- Tool execution errors (invalid arguments, forbidden scope, file not found) are returned as a `200` JSON-RPC response with `result.isError: true`, not an HTTP-level error — this is how MCP distinguishes protocol-level failures (bad auth, malformed JSON-RPC) from tool-level failures.
- The server is stateless: no session ID, each HTTP request is independent. Responses are plain JSON; only the optional AI tool (`collabpro_create_diagram`) switches to an SSE stream so it can send `notifications/progress`.
- Unauthenticated or invalid-token requests get `401` with `WWW-Authenticate: Bearer resource_metadata="…"` (this is what starts Claude's sign-in). A bad-scope credential is `403` with no such header. Once authenticated, a read-only grant calling a write tool is **not** an HTTP error: it is a `200` JSON-RPC response with `result.isError: true` ("Forbidden: … read-only access scope").
- Claude limits: ~150k characters per tool result, 240 s per call; OAuth discovery/registration/token endpoints must answer in under 10 s (30 s for refresh).

## Reliability, limits, and audit

- **Rate limiting**: 120 requests/minute per API key (`LIMITS.MCP` in `lib/rate-limiter.ts`, same Redis-backed/in-memory-fallback limiter every other endpoint uses). Exceeding it returns `429` with a `Retry-After` header and a JSON-RPC `{code: -32000, message: "Rate limit exceeded"}` body.
- **Body size cap**: requests over 5MB are rejected with `413` before the body is parsed.
- **Audit log**: `mcp:auth:failure`, `mcp:rate_limited` (once per blocked window, not once per request), `mcp:create_file`, `mcp:update_document`, and `mcp:update_whiteboard` are written to the same `AuditLog` table as every other security-relevant action in the app (auth, API key, team/org changes) — an unattended agent editing content is exactly the kind of action worth an audit trail, unlike a routine human edit through the editor UI.
- **Observability**: every request logs a single structured `mcp_request` line (`lib/logger.ts`) with the calling user, JSON-RPC method, tool name, response status, and duration.

## Operator controls (kill switches)

Environment variables, read per request, so a Railway variable change plus restart takes effect without a code change:

| Variable | Effect |
|---|---|
| `MCP_DISABLED=true` | `/api/mcp` answers `503` for everyone |
| `MCP_READ_ONLY=true` | every MCP caller is forced to read-only |
| `MCP_DISABLED_TOOLS=a,b` | named tools are hidden and uncallable |
| `OAUTH_DISABLED=true` | OAuth endpoints and OAuth tokens stop working (API keys unaffected) |
| `APP_URL` / `OAUTH_ISSUER` | pins the public origin used in discovery metadata (and allows it to be cached) |
| `CRON_SECRET` | enables `POST /api/internal/oauth-cleanup` (Bearer-protected); unset = endpoint returns 404 |

See [`runbooks/mcp.md`](runbooks/mcp.md) for SLOs, alerts and incident steps, and [`mcp-threat-model.md`](mcp-threat-model.md) for the prompt-injection model.

## Whose AI tokens get spent

`lib/mcp/tools.ts` does not call an LLM on its own — every tool except one is plain CRUD/layout against Postgres. The exception is `collabpro_create_diagram`, which is only registered when a team has configured its own provider (Settings → AI) and then spends **that team's key** (`lib/mcp/ai-spec.ts`); the model only returns a small graph spec, layout stays deterministic. So when an AI coding tool (Claude Code, Copilot, Cursor, Windsurf) calls a CollabPro tool, 100% of the reasoning/generation happens in that tool's own model, billed to its own tokens — CollabPro has no API key to a model provider and nothing here can spend one. `scripts/demo-mcp-ai.ts` demonstrates this from the other direction: it's the caller supplying its own `NVIDIA_API_KEY` to drive tool calls, not the server.

Claude does not support [MCP sampling](https://modelcontextprotocol.io/specification/2025-06-18/client/sampling), so there is no fallback to the caller's tokens: without a configured team provider the AI tool simply isn't offered, and callers use the free `collabpro_apply_diagram_spec` instead.

## Troubleshooting

Use the **Run Handshake Diagnostics** button on the MCP settings page — it makes a real `initialize` + `tools/list` call against `/api/mcp` with your selected key and shows the actual response (or actual error), rather than a canned success message.

- **401 Unauthorized** — API key missing, invalid, revoked, or expired; or an OAuth token expired (Claude refreshes automatically; if it can't, re-add the connector).
- **Claude says "Couldn't reach the MCP server"** — discovery failed: check `curl <app-url>/.well-known/oauth-protected-resource` returns `resource` equal to the URL you pasted, and that a WAF/proxy isn't blocking `/.well-known/*` or `160.79.104.0/21`.
- **"Cross-origin request rejected" (403) on the consent screen** — the POST had no `Origin` matching this server's public origin and, when `Origin` was absent or `null` (the normal case here), no `Sec-Fetch-Site: same-origin` either. Make sure you reached the consent page on the same hostname as `APP_URL` (not a `*.up.railway.app` or `www.` alias) and use a current browser.
- **"redirect_uri is not registered"** — remove and re-add the connector (a stale client was pruned).
- **`isError` "Forbidden" (HTTP 200)** — the key/grant is `read-only` and you called a write tool; re-authorize with write access.
- **406 Not Acceptable** — your client isn't sending the required `Accept` header (see above); this is a client bug, not a server one.
- **stdio bridge exits immediately** — `COLLABPRO_API_KEY` is unset in its environment.
