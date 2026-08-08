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

## Tools

| Tool | Description | Requires write scope |
|---|---|---|
| `collabpro_list_files` | List files/folders in scope (`org`, `team`, or `personal`), optionally filtered by `teamId`. Paginated (`limit` 1-200, default 50; pass back `nextCursor` for the next page). | No |
| `collabpro_get_file` | Fetch a single file's document blocks and whiteboard elements by `fileId`. | No |
| `collabpro_update_document` | Overwrite a file's document (Editor.js payload, object or JSON string). | Yes |
| `collabpro_update_whiteboard` | Overwrite a file's whiteboard (array of Excalidraw-compatible elements, or JSON string). Server-side layout validation — see below. | Yes |
| `collabpro_search_icon_libraries` | Keyword search over the 200+ community Excalidraw icon libraries ([libraries.excalidraw.com](https://libraries.excalidraw.com): AWS/Azure/GCP/network/UML/BPMN/etc). Returns each match's `source` string. | No |
| `collabpro_get_library_icon` | Fetch one icon's elements from a library (`librarySource` + `item`), translated to `(x, y)` and ID-namespaced — pass the result straight into `collabpro_update_whiteboard`'s `whiteboard` array. | No |

All inputs are validated by the SDK against each tool's Zod schema before the handler runs — a missing or wrong-typed required field is rejected as a tool error automatically. Access is scoped to teams the authenticated API key's user belongs to; a `read-only`-scoped key gets a `Forbidden` tool error on either write tool. Writes go through the same compare-and-swap writers (`lib/cas-writes.ts`) as every other write path in the app (HTTP state-sync, the WebSocket gateway), so a concurrent human edit can't be silently clobbered. Every tool also declares [MCP annotations](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool-annotations) (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) so a well-behaved client can reason about risk (and about which tools touch the network) before calling one.

Run **tools/list** against your server to see the exact current schema — it's generated directly from the Zod definitions in `lib/mcp/tools.ts`, so it can never drift from what the tools actually accept.

### Whiteboard layout enforcement

`collabpro_update_whiteboard` rejects a write outright (no partial persist) if any shape (`rectangle`/`ellipse`/`diamond`) has a non-finite `x`/`y`/`width`/`height`, or if two shapes overlap without sharing a `groupIds` entry — the error names the exact offending element(s) so a caller can fix and retry. Same-`groupIds` shapes are exempt because a composite icon's parts are *meant* to overlap (that's how a vector icon is drawn from primitives); this exemption was added after round-tripping a real AWS library icon through the check and watching it get (incorrectly) rejected. This is enforcement, not a suggestion — it applies identically no matter which AI or client is calling. The full layout/color/typography guidance lives in the `collabpro_diagram_guidelines` **prompt** below, not just the tool description, since a prompt is what a client is meant to pull into its own context before it starts generating.

### Icon libraries

`collabpro_search_icon_libraries` → `collabpro_get_library_icon` chain together: search by keyword, take a result's `source`, fetch a specific item (by 0-based index or name substring) at a target position. The fetch only ever hits the fixed `excalidraw/excalidraw-libraries` GitHub repo (`librarySource` is validated against `author/name.excalidrawlib`, never a full URL — no SSRF surface), is cached in-memory for an hour, and rejects any item containing an `image` element (won't render through this whiteboard's export path — see `lib/mcp/icon-libraries.ts`).

## Prompts

| Prompt | Description |
|---|---|
| `collabpro_diagram_guidelines` | Layout, semantic color palette, typography, and icon-library guidance for `collabpro_update_whiteboard`, condensed from [Agents365-ai/excalidraw-skill](https://github.com/Agents365-ai/excalidraw-skill) (MIT). Fetch via `prompts/get` before drafting a diagram. |

Prompts are a distinct MCP primitive from tools (`prompts/list`, `prompts/get`) — check your client supports them; not every MCP client surfaces prompts in its UI.

## Protocol notes

- The Streamable HTTP transport requires the `Accept: application/json, text/event-stream` request header, per spec. A request missing it gets a `406 Not Acceptable` — this is correct, not a bug.
- Tool execution errors (invalid arguments, forbidden scope, file not found) are returned as a `200` JSON-RPC response with `result.isError: true`, not an HTTP-level error — this is how MCP distinguishes protocol-level failures (bad auth, malformed JSON-RPC) from tool-level failures.
- The server runs statefully-free: no session ID, no SSE stream — each HTTP request is independent, since none of these tools need server-initiated notifications.

## Reliability, limits, and audit

- **Rate limiting**: 120 requests/minute per API key (`LIMITS.MCP` in `lib/rate-limiter.ts`, same Redis-backed/in-memory-fallback limiter every other endpoint uses). Exceeding it returns `429` with a `Retry-After` header and a JSON-RPC `{code: -32000, message: "Rate limit exceeded"}` body.
- **Body size cap**: requests over 5MB are rejected with `413` before the body is parsed.
- **Audit log**: `mcp:auth:failure`, `mcp:rate_limited` (once per blocked window, not once per request), `mcp:update_document`, and `mcp:update_whiteboard` are written to the same `AuditLog` table as every other security-relevant action in the app (auth, API key, team/org changes) — an unattended agent editing content is exactly the kind of action worth an audit trail, unlike a routine human edit through the editor UI.
- **Observability**: every request logs a single structured `mcp_request` line (`lib/logger.ts`) with the calling user, JSON-RPC method, tool name, response status, and duration.

## Whose AI tokens get spent

`lib/mcp/tools.ts` never calls an LLM — every tool is plain CRUD (list/get/update) against Postgres. So when an AI coding tool (Claude Code, Copilot, Cursor, Windsurf) calls a CollabPro tool, 100% of the reasoning/generation happens in that tool's own model, billed to its own tokens — CollabPro has no API key to a model provider and nothing here can spend one. `scripts/demo-mcp-ai.ts` demonstrates this from the other direction: it's the caller supplying its own `NVIDIA_API_KEY` to drive tool calls, not the server.

If a future tool needs server-side generation (e.g. an AI content-authoring tool), the extension point is `McpToolContext` (`lib/mcp/tools.ts`): resolve an optional org/account-level provider key there (e.g. from a settings table) and have that tool use it only when present, falling back to [MCP sampling](https://modelcontextprotocol.io/specification/2025-06-18/client/sampling) (asking the connected client to run the completion on the caller's tokens) when it isn't configured. Nothing in the current architecture blocks adding this — it just doesn't exist yet because no tool needs it.

## Troubleshooting

Use the **Run Handshake Diagnostics** button on the MCP settings page — it makes a real `initialize` + `tools/list` call against `/api/mcp` with your selected key and shows the actual response (or actual error), rather than a canned success message.

- **401 Unauthorized** — API key missing, invalid, revoked, or expired.
- **403 / `isError` "Forbidden"** — the key's scope is `read-only` and you called a write tool.
- **406 Not Acceptable** — your client isn't sending the required `Accept` header (see above); this is a client bug, not a server one.
- **stdio bridge exits immediately** — `COLLABPRO_API_KEY` is unset in its environment.
