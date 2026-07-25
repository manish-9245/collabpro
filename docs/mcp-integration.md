# MCP Integration

CollabPro exposes a [Model Context Protocol](https://modelcontextprotocol.io) server so AI agents (Claude, Cursor, Windsurf, or any custom MCP client) can list, read, and edit your files and whiteboards.

## Architecture

There is exactly one real MCP server, and one tool registry:

- **`lib/mcp/tools.ts`** — the canonical tool definitions (Zod schemas + handlers). This is the single source of truth; nothing else defines tools.
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
| `collabpro_list_files` | List files/folders in scope (`org`, `team`, or `personal`), optionally filtered by `teamId`. | No |
| `collabpro_get_file` | Fetch a single file's document blocks and whiteboard elements by `fileId`. | No |
| `collabpro_update_document` | Overwrite a file's document (Editor.js payload, object or JSON string). | Yes |
| `collabpro_update_whiteboard` | Overwrite a file's whiteboard (array of Excalidraw-compatible elements, or JSON string). | Yes |

All inputs are validated by the SDK against each tool's Zod schema before the handler runs — a missing or wrong-typed required field is rejected as a tool error automatically. Access is scoped to teams the authenticated API key's user belongs to; a `read-only`-scoped key gets a `Forbidden` tool error on either write tool. Writes go through the same compare-and-swap writers (`lib/cas-writes.ts`) as every other write path in the app (HTTP state-sync, the WebSocket gateway), so a concurrent human edit can't be silently clobbered.

Run **tools/list** against your server to see the exact current schema — it's generated directly from the Zod definitions in `lib/mcp/tools.ts`, so it can never drift from what the tools actually accept.

## Protocol notes

- The Streamable HTTP transport requires the `Accept: application/json, text/event-stream` request header, per spec. A request missing it gets a `406 Not Acceptable` — this is correct, not a bug.
- Tool execution errors (invalid arguments, forbidden scope, file not found) are returned as a `200` JSON-RPC response with `result.isError: true`, not an HTTP-level error — this is how MCP distinguishes protocol-level failures (bad auth, malformed JSON-RPC) from tool-level failures.
- The server runs statefully-free: no session ID, no SSE stream — each HTTP request is independent, since none of these tools need server-initiated notifications.

## Troubleshooting

Use the **Run Handshake Diagnostics** button on the MCP settings page — it makes a real `initialize` + `tools/list` call against `/api/mcp` with your selected key and shows the actual response (or actual error), rather than a canned success message.

- **401 Unauthorized** — API key missing, invalid, revoked, or expired.
- **403 / `isError` "Forbidden"** — the key's scope is `read-only` and you called a write tool.
- **406 Not Acceptable** — your client isn't sending the required `Accept` header (see above); this is a client bug, not a server one.
- **stdio bridge exits immediately** — `COLLABPRO_API_KEY` is unset in its environment.
