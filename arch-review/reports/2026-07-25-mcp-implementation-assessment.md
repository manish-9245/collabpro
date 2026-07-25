# CollabPro MCP Implementation — Assessment
**Date:** 2026-07-25 · **Scope:** `scripts/mcp-server.ts`, `app/api/mcp/route.ts`, `app/api/state-sync/**`, `lib/api-key-middleware.ts`, `app/(routes)/dashboard/settings/mcp/page.tsx`, MCP unit tests

Confirmed: `grep -i "modelcontextprotocol" package.json` → no hits. There is no `@modelcontextprotocol/sdk` dependency. Everything here — JSON-RPC framing, lifecycle, transport, schema shapes — was hand-written against the spec rather than generated/validated by the official SDK.

---

## Summary verdict

**It does not work as documented, and the parts that would work are not the parts a user is told to set up.**

There are actually **two independent, drifted MCP servers** in this repo:

1. A **stdio** server (`scripts/mcp-server.ts`) — this is the one the Settings UI tells every user (Claude Desktop, Cursor, Windsurf, "Custom") to configure.
2. An **HTTP JSON-RPC** route (`app/api/mcp/route.ts`) — fully built (auth, Prisma queries, scoping, 337 lines), but **never referenced by the settings UI, never mentioned in any client config generator, and not the transport any of the documented clients are told to use.** It is orphaned work: functioning code nobody's setup instructions point at.

Of the two, the documented one (stdio) is the one a real user would actually try, and it is broken in a way that a first-time user hits immediately:

- The config the Settings page generates sets the wrong environment variable name for the server's own base-URL setting, so every deployed (non-localhost) instance silently talks to `localhost:3000` instead (page.tsx:90/97 vs scripts/mcp-server.ts:10).
- The one "write" tool most useful to an AI agent — `collabpro_update_document` — is wired end-to-end except for one missing dispatch branch, so every call to it 404s (state-sync/route.ts:232).
- Read-only-scoped API keys — the option CollabPro's own UI would reasonably tell a cautious user to hand to an AI agent — cannot use MCP **at all**, for any operation, including reads (`lib/api-key-middleware.ts:86-98` misapplied to `app/api/mcp/route.ts:9`).
- Neither server declares the `tools` capability in its `initialize` response, which is a spec **MUST** for any server offering tools.
- The "Run Diagnostics" handshake button in the settings UI is entirely fabricated client-side theater — it never calls the server, and its hard-coded "success" output lists tool names (`collabpro_read_board`, `collabpro_write_board`, `collabpro_create_file`) that don't exist anywhere in the actual implementation.

None of this is caught by the two existing test files, because neither exercises the real dispatch path end to end (see Test Coverage Gap below).

If a real MCP client connects today: `initialize` and `tools/list` will work; `tools/call` for reading data will mostly work for read-write-scoped keys; `collabpro_update_document` will always fail; read-only keys will fail on everything; and anyone who copy-pastes the generated config against a non-local deployment will silently hit `localhost:3000` instead of their real server.

---

## Protocol compliance findings

Spec basis: [Lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle), [Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).

| # | Finding | Evidence | Spec basis |
|---|---|---|---|
| PC1 | **Missing `tools` capability declaration.** Both servers respond to `initialize` with `capabilities: {}`. A server offering tools **MUST** declare `capabilities.tools`. | `scripts/mcp-server.ts:53-60`, `app/api/mcp/route.ts:44-57` | "Servers that support tools **MUST** declare the `tools` capability" — [server/tools §Capabilities](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) |
| PC2 | **`protocolVersion` is hard-coded, request is never inspected.** Both servers ignore `params.protocolVersion` from the client and always answer `2024-11-05`. This happens to be spec-legal (server may answer with any version it supports), but it means there is no actual negotiation logic — a client requesting `2025-06-18` gets no acknowledgment of that, and the server has no path to ever advertise a newer version. | `scripts/mcp-server.ts:52-60`; `app/api/mcp/route.ts:44-56` | "If the server supports the requested protocol version, it MUST respond with the same version. Otherwise... another version it supports" — [Lifecycle §Version Negotiation](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#version-negotiation) |
| PC3 | **Tool-execution vs protocol errors are correctly distinguished in the stdio server** — actual tool failures (fetch errors, `state-sync` errors) come back as a normal JSON-RPC *result* with `isError: true`, not a JSON-RPC error object; unknown tools/methods correctly use JSON-RPC `error`. This part matches spec. | `scripts/mcp-server.ts:207-209 (unknown tool → sendError)`, `225-273 (execution failure → isError:true result)` | "Tool Execution Errors: Reported in tool results with `isError: true`" — [server/tools §Error Handling](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#error-handling) |
| PC4 | **Unknown-tool error code diverges from the spec's own example.** `-32601` (Method not found) is used for an unknown tool name; the spec's worked example for this exact case uses `-32602` (Invalid params). Not a hard violation (the spec doesn't mandate a specific code), but it's the kind of inconsistency schema-driven SDKs prevent by construction. | `scripts/mcp-server.ts:208`, `app/api/mcp/route.ts:314-319` | Spec example: `"Unknown tool: invalid_tool_name"` → code `-32602` — [server/tools §Error Handling](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#error-handling) |
| PC5 | **No `inputSchema` validation before dispatch.** Both servers declare JSON Schema `inputSchema` per tool, but neither validates `arguments` against it — they just destructure fields and let downstream Prisma/`state-sync` calls fail (or silently coerce) on bad input. The official TS SDK does this automatically via Zod (`registerTool` + Standard Schema validation); a hand-rolled server has to do it itself and here it simply doesn't. | `app/api/mcp/route.ts:157-320` (switch dispatches directly on `args` with no schema check); `scripts/mcp-server.ts:173-210` (same) | Tools §Security Considerations: "Servers MUST: Validate all tool inputs" — [server/tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#security-considerations) |
| PC6 | **Schema drift between the two servers for the same tool names.** `collabpro_update_document`'s `document` param is typed as a structured `object` with `blocks` in the stdio server, but as a JSON-encoded `string` in the HTTP route; same drift for `whiteboard`. A client that discovers tools from one server and calls the other (or a client whose author read one file and not the other) will send input the receiving server doesn't expect. | `scripts/mcp-server.ts:115-124` (`document: object{blocks:[]}`) vs `app/api/mcp/route.ts:107-113` (`document: string`) | N/A — internal consistency issue, not spec text |

---

## Transport findings

Spec basis: [Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).

**stdio (`scripts/mcp-server.ts`) — mechanically correct.** Newline-delimited JSON-RPC over stdin/stdout, stderr used for logging (never stdout) — this matches the spec's stdio requirements exactly: "Messages are delimited by newlines, and MUST NOT contain embedded newlines" / "server MAY write UTF-8 strings to its standard error for logging" (`mcp-server.ts:12-14, 22-38`). This is the one piece of the implementation that is genuinely spec-correct at the wire level.

**HTTP (`app/api/mcp/route.ts`) — not a compliant Streamable HTTP transport, and not wired to any documented client:**

- **No GET handler on the MCP endpoint.** The spec requires the MCP endpoint to support both POST and GET (GET opens an SSE stream for server-initiated messages, or the server must answer 405). Only `export async function POST` exists (`route.ts:5`); Next.js will auto-405 unrouted methods, which technically satisfies the letter of "return 405 if you don't offer SSE," but it means this is intentionally POST-only/request-response, never streamable — fine for a stateless tool-call server, but the settings UI never tells any client to *use* this URL in the first place, so this compliance detail is moot in practice.
- **No `Origin` header validation.** Spec Security Warning: "Servers MUST validate the Origin header on all incoming connections to prevent DNS rebinding attacks." `route.ts` has no `Origin` check anywhere. Partially mitigated in this case by Bearer-token auth (no ambient cookie credential to piggyback on), but it is a documented **MUST** that is simply absent.
- **No `MCP-Protocol-Version` header handling.** Spec: "the client MUST include the MCP-Protocol-Version header on all subsequent requests... If the server receives a request with an invalid or unsupported MCP-Protocol-Version, it MUST respond with 400 Bad Request." The route never reads this header.
- **No `Mcp-Session-Id` issuance or checking.** Optional per spec (server *MAY* assign one), so not a violation by itself — but combined with no `Origin`/version checks, there is effectively zero session or version state on the HTTP path; every request is independently authenticated and dispatched with no continuity guarantees beyond the Bearer token.
- **This route is disconnected from the documented product flow.** `app/(routes)/dashboard/settings/mcp/page.tsx` has four tabs (Claude Desktop, Cursor, Windsurf, Custom Stdio) and **all four generate a stdio launch config for `scripts/mcp-server.ts`** (`page.tsx:77-97`) — none of them ever reference `/api/mcp`. The HTTP route is real, tested (see below), and unreachable from any onboarding path in the product.

**The stdio server itself doesn't call `/api/mcp` either.** It proxies every `tools/call` to a *third* endpoint, `/api/state-sync`, using a bespoke `{path, args}` envelope (`scripts/mcp-server.ts:170-223`) that has nothing to do with JSON-RPC — it's this repo's internal RPC-over-REST convention (see `app/api/state-sync/route.ts:46`). So the three pieces of "MCP" in this repo — the documented stdio launcher, the tested HTTP JSON-RPC route, and the internal API the stdio launcher actually talks to — are three separate surfaces that happen to share tool names.

**Would a real client connect at all?** Yes, mechanically: Claude Desktop / Cursor / Windsurf all support launching an arbitrary `command`+`args`+`env` stdio subprocess, which is exactly what the generated config does. Whether it would *work* depends entirely on `npx ts-node` succeeding at runtime (see below) and on the base-URL bug (Pitfall #1).

---

## Auth findings

`lib/api-key-middleware.ts:22-105` — key format `collabpro_pat_*`, SHA-256 hash lookup (`hashApiKey`, line 15-17), expiry check (line 75-83), scope check (line 86-98).

**The scope check is the wrong shape for a JSON-RPC-over-HTTP endpoint, and it silently locks out read-only keys entirely.**

```
if (requestMethod && apiKeyRecord.scope === 'read-only') {
  const uppercaseMethod = requestMethod.toUpperCase();
  const isWriteOperation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(uppercaseMethod);
  if (isWriteOperation) { ... 403 Forbidden ... }
}
```
`lib/api-key-middleware.ts:86-98`

This function was written for `app/api/state-sync/route.ts`, a conventional REST-ish endpoint where "GET = read, POST = write" is a reasonable proxy for scope. It is reused verbatim by `app/api/mcp/route.ts:9` — `verifyApiKey(authHeader, request.method)` — but **every JSON-RPC call over HTTP, including `initialize` and `tools/list`, is an HTTP POST.** There is no GET path in JSON-RPC-over-HTTP. The result: any API key created with `scope: 'read-only'` gets a 403 on **every single call to `/api/mcp`**, including pure reads. A read-only key is the option a security-conscious user would naturally choose to hand to an AI agent, and it is unconditionally non-functional for MCP.

This bug is invisible in the route's own code because `route.ts` *also* implements a second, correct, method-name-based scope check for the two write tools specifically (`route.ts:217-223` and `266-272`: `if (authResult.scope === 'read-only') return 403` gated on the tool being `collabpro_update_document`/`collabpro_update_whiteboard`). That second check is redundant and never actually reached for read-only keys today, because the first (middleware) check already rejects the request before the route's own switch statement runs. Two overlapping scope-enforcement mechanisms exist; the wrong one wins.

Other auth notes:
- Key hashing (SHA-256, no salt/pepper) and prefix check (`collabpro_pat_`) are consistent with the repo's existing `ApiKey` model (`prisma/schema.prisma:183-197`: `hashedKey`, `maskedKey`, `scope` default `'read-write'`) — nothing MCP-specific is wrong here.
- No MCP-specific rate limiting. The repo added a general auth-endpoint rate limiter in #182 (per project memory), but `/api/mcp` isn't in scope for it — an agent that free-loops on `tools/call` has no throttle.
- `app/api/state-sync/route.ts` layers a second, independent authorization system on top (guest/shared-link role checks at lines 119-140, per-file `checkFileAccess` at 176-186, per-team `checkTeamAccess` at 200-210) — this part is well-built and does correctly scope `collabpro_update_document`/`collabpro_update_whiteboard` to the caller's team membership before dispatch. The bug is only in reaching that code at all (see Pitfall #2 below).

---

## Test coverage gap

`tests/unit/mcp-route.test.ts` (152 lines) and `tests/unit/mcp-settings.test.ts` (60 lines) are the entirety of MCP-specific test coverage.

**What is actually verified:**
- `mcp-route.test.ts` calls the real `POST` handler from `app/api/mcp/route.ts` with `prisma` mocked and **`verifyApiKey` itself mocked out** (`vi.mock('@/lib/api-key-middleware', ...)`, lines 23-25). It checks: 401 on missing/invalid key, 400 on bad JSON, `tools/list` returns 4 tools, `collabpro_list_files` returns team-scoped data, and a 403 when `verifyApiKey` is *told to return* `scope: 'read-only'`.
- `mcp-settings.test.ts` asserts nothing about running code — it hand-builds plain JS object literals (`mockClaudeConfig`, `cursorCommand`, `mockLogs`) inline in the test file and asserts they equal themselves. It never imports `page.tsx`, never renders the component, never calls `runDiagnostics`. It is testing a copy of the shape the component happens to produce, not the component.

**What is completely untested:**
- **The scope bug (Auth findings above) is invisible by construction** — because `verifyApiKey` is mocked, the real HTTP-method-based scope logic in `lib/api-key-middleware.ts` never runs in any MCP test. The one test that exercises "read-only scope" (`mcp-route.test.ts:126-151`) proves the *route's own* redundant check works, while never calling the real middleware that actually gates every request first.
- **`scripts/mcp-server.ts` (the stdio server) has zero test coverage.** No test spawns it, feeds it stdin, or asserts on its stdout. It is the server every documented client is told to run, and nothing verifies it parses input, calls `/api/state-sync` correctly, or produces valid JSON-RPC output.
- **`app/api/state-sync/route.ts`'s dispatch of `collabpro_update_document`/`collabpro_update_whiteboard`** (the actual execution path the stdio server depends on) is not exercised through the router at all in a way that would catch a missing `path.startsWith(...)` branch — `tests/unit/performance-sync.test.ts` tests `handleFileService`'s internal cases directly, not `POST_handler`'s prefix-matching dispatcher. This is exactly why Pitfall #2 (below) shipped and stayed shipped.
- **No test asserts the actual JSON-RPC wire format end-to-end** for the stdio path — no newline-framing test, no `initialize`→`initialized`→`tools/call` sequence test, nothing checking `capabilities.tools` is present.
- **The fabricated "Run Diagnostics" UI is untested for what it actually does** (nothing) — `mcp-settings.test.ts` never renders the component or clicks the button; it only re-asserts a copy of the log strings the author expects the setTimeout chain to produce.

---

## Ranked pitfalls

Ordered by "how fast a real user hits this."

1. **Wrong env var name breaks every non-localhost deployment (severity: immediate, silent).** The Settings UI generates `"COLLABPRO_URL": baseAppUrl` for Claude Desktop (`page.tsx:90`) and `COLLABPRO_URL=${baseAppUrl}` for Cursor/Windsurf (`page.tsx:97`), but the server reads `process.env.COLLABPRO_BASE_URL` (`scripts/mcp-server.ts:10`), falling back silently to `http://localhost:3000` when that var is absent. Anyone who follows the UI's own instructions against a deployed (non-localhost) CollabPro instance gets a server that connects fine (stdio handshake succeeds) but sends every tool call to `localhost:3000` — which either 404s/connection-refuses locally, or worse, silently talks to whatever *is* running on the user's own localhost:3000. No error surfaces the mismatch; it just doesn't work, or works against the wrong target.

2. **`collabpro_update_document` always fails (severity: immediate, for the primary write tool).** `app/api/state-sync/route.ts:232` dispatches to `handleFileService` only when `path.startsWith('files:') || path === 'collabpro_update_whiteboard'`. `collabpro_update_document` matches neither — it passes the earlier file-access check (it's listed at `route.ts:147`) but then falls through every `startsWith` branch to the `else` at lines 242-244, returning `404 { error: "Method collabpro_update_document not implemented" }`. `handleFileService` (`app/api/state-sync/services/fileService.ts:199`) has a fully implemented `case 'collabpro_update_document'` that is simply unreachable. This is a one-line dispatcher omission (`collabpro_update_whiteboard` was added to the `startsWith` condition when its case was implemented; `collabpro_update_document` wasn't).

3. **Read-only API keys cannot use MCP at all (severity: immediate for anyone who picks the "safe" option).** Detailed in Auth findings — `lib/api-key-middleware.ts:86-98`'s scope check is keyed on HTTP method, and every MCP call over `app/api/mcp/route.ts` is a POST, so `scope: 'read-only'` keys get 403'd on every method including `tools/list`. A user who deliberately scopes down the key they hand to an AI agent gets total lockout, with an error message ("Forbidden: API key has read-only access scope") that doesn't explain the real cause.

4. **Missing `tools` capability may cause spec-strict clients to never call `tools/list`.** Both `initialize` responses answer `capabilities: {}` (`scripts/mcp-server.ts:55`, `app/api/mcp/route.ts:49`). Lenient clients (most current ones) call `tools/list` anyway; a client that follows the spec's capability-negotiation guidance strictly could treat the absent `tools` capability as "this server has no tools" and skip discovery entirely, silently presenting an agent with zero tools.

5. **`npx -y ts-node --compiler-options {...} scripts/mcp-server.ts` is fragile.** `ts-node` is not a project dependency (`package.json` has no `ts-node` entry) — `npx -y` will fetch it from the registry on first run. This means: first launch requires network access and takes noticeably longer (no lockfile-pinned version, so behavior can drift across users/machines with different cached `npx` versions), and any offline/air-gapped or CI environment following the same instructions will fail outright. Not fatal, but the "it just works" promise in the UI (`page.tsx:341-345`: "Relaunch your Claude Desktop Client app to establish connection handshake") assumes network + npm registry access that isn't guaranteed.

6. **The "Run Diagnostics" button lies to users.** `runDiagnostics()` (`page.tsx:99-134`) never performs a network call — it's a hard-coded sequence of `setTimeout`-staggered log lines that always ends in `"✅ Handshake 100% Success!"` as long as an API key is selected (line 100 only checks the key isn't the placeholder). Its final "discovered tools" list (`collabpro_read_board`, `collabpro_write_board`, `collabpro_list_files`, `collabpro_create_file`) matches **none** of the four real tool names (`collabpro_list_files`, `collabpro_get_file`, `collabpro_update_document`, `collabpro_update_whiteboard`). A user troubleshooting a real connection failure gets a UI confidently telling them everything works, using tool names that were never implemented.

7. **Two servers, drifted schemas, no source of truth.** `collabpro_update_document`'s `document` argument is a structured object (`{blocks: [...]}`) in `scripts/mcp-server.ts:115-124` vs. a JSON string in `app/api/mcp/route.ts:107-113`; same split for `whiteboard`. Nothing keeps these in sync (no shared schema module, no codegen) — the pattern this repo has elsewhere of hand-duplicating logic that should have one source of truth. Since only the stdio server is reachable from documented client configs, the HTTP route's tool schemas are effectively dead documentation today — but if the HTTP route were ever wired up, a client that cached tool schemas from one server would send the wrong shape to the other.

8. **No input-schema validation, no rate limiting, no `Origin` check on the HTTP route** — lower severity today mainly because the HTTP route isn't reachable via any documented flow, but each is a documented spec **MUST**/security requirement (see Protocol/Transport findings) that would need addressing before that route is exposed to real clients.

---

## What would need to change to actually work with a real MCP client

1. **Fix the env var name mismatch** — either read `COLLABPRO_URL` in `scripts/mcp-server.ts:10`, or generate `COLLABPRO_BASE_URL` in `page.tsx:90/97`. One-line fix, but currently breaks every non-localhost setup.
2. **Add `collabpro_update_document` to the dispatch condition** at `app/api/state-sync/route.ts:232` (`path.startsWith('files:') || path === 'collabpro_update_whiteboard' || path === 'collabpro_update_document'`, or better, use an explicit allowlist Set shared with the `filePaths` array above it so this class of bug can't recur).
3. **Fix the scope check for the MCP endpoint.** Either stop passing `request.method` into `verifyApiKey` from `app/api/mcp/route.ts` (since it's meaningless there) and rely solely on the route's own per-tool-name scope check (already present at lines 217-223/266-272), or teach `verifyApiKey` to accept a "this is a read operation" flag derived from the JSON-RPC method/tool name rather than the HTTP verb.
4. **Declare `capabilities: { tools: {} }` in both `initialize` responses.**
5. **Decide which server is real and delete the other**, or actually wire the HTTP route into the settings UI as a genuine alternative transport (with `Origin` validation, `MCP-Protocol-Version` handling, and a GET/SSE path if streaming is ever needed) — right now maintaining both means every future tool addition has to be made (correctly) twice, and the settings UI already only exercises one.
6. **Make "Run Diagnostics" real** — actually spawn/curl the configured server and show its real `tools/list` output, or remove the button. A fabricated success state is worse than no diagnostics at all.
7. **Add input-schema validation before dispatch** in both servers (even a small ad hoc JSON-Schema check, or — the actual lazy fix — adopt `@modelcontextprotocol/sdk`'s `McpServer`/`registerTool`, which validates via Zod and also fixes items 4 and the transport-correctness gaps for free).
8. **Add an integration test that starts from an HTTP request into `/api/mcp` (or spawns `scripts/mcp-server.ts` and pipes JSON-RPC through real stdin/stdout) without mocking `verifyApiKey` or the state-sync dispatcher** — this is the single test that would have caught pitfalls #2 and #3 before they shipped.

The honest framing for the "how effectively is this made" question: the protocol-adjacent plumbing (JSON-RPC envelope shape, stdio framing, error-vs-isError distinction) shows someone read the spec. What's missing is exactly what an SDK buys you for free — capability negotiation that means something, schema validation, and one consistent tool surface — plus the ordinary engineering discipline of an integration test that exercises the real dispatch path. Right now this would demo successfully in a "look, `tools/list` returns four tools" screenshot, and fail on the second tool call a real user tries.
