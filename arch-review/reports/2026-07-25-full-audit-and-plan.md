# CollabPro — Full Audit & Remediation Plan
**Date:** 2026-07-25 · **Branch audited:** `feature/issue-175` · **Prod:** Railway project `CollabPro` (asia-southeast1)

---

## Status — updated 2026-07-25 after remediation pass

### Done

| Item | Where |
|---|---|
| `SESSION_SECRET` + `NOTIFICATION_SECRET` generated and set on `collabpro` and `collabpro-ws` | Railway |
| Auth bypass closed — verified in production that a token forged with the old public secret is rejected | PR #178 |
| JWT `iat`/`exp` claims, 24h lifetime, cookie `maxAge` aligned | PR #178 |
| Middleware fails safe instead of 500-ing when the secret is unavailable at Edge build time | PR #178 |
| CI split into build/lint/test, with E2E, showcase video, YouTube upload and notification email preserved as a gated `e2e` job | PR #179 |
| WS mutation idempotency made functional (`writeClient` was never assigned; `mutationId` used `Date.now()` twice) | PR #180 |
| Auth rate limits re-keyed on source IP — the original email-only key allowed unthrottled password spraying and victim lockout | PR #182 |
| FK migration `onDelete` corrected from CASCADE to SET NULL — as written it would have cascaded away Teams and every File in them | PR #181 |
| Production migration state verified (14 tables, no `_prisma_migrations`) and baseline procedure documented | `prisma/migrations/BASELINE.md` |

### Filed as issues

#183 share-link IDOR · #184 share password hashing · #185 telemetry auth + fabricated metrics · #186 ws service running wrong process · #187 block-merge duplication · #188 Yjs not a CRDT · #189 duplicated merge helpers · #190 polling payloads + dead Redis cache · #191 missing indexes · #192 Railway healthchecks/drain/pinning · #193 Docker image bloat · #194 db pool + credential logging · #195 SVG XSS · #196 coverage excludes `app/api` · #197 per-process state blocks scaling · #198 WS hot-path cost · #199 hygiene batch · #200 FileVersion retention · #201 S3 public endpoint

Existing issues enriched with audit findings: #170, #171, #174, #175, #176.

### Still open and most urgent

1. **#186** — `collabpro-ws` runs the Next.js app, not the WS server. Real-time collaboration is dead in production and this is also the largest performance win available.
2. **#183** — any authenticated user can mint an editor share link to any file.
3. **#190** — `REDIS_URL` is still unset on the `collabpro` service, so the file cache never engages.

---

## 0. Executive summary

Three things are true right now and each is independently serious:

1. **Production authentication is forgeable.** The `collabpro` Railway service has no `SESSION_SECRET`, so `lib/session-auth/jwt.ts` falls back to the hardcoded literal `'super-secret-collabpro-key-12345678-abcdefgh'`, which is committed to a public GitHub repo. Anyone can mint a valid `session_token` for any user. Tokens also have no expiry.
2. **Real-time collaboration is dead in production.** The `collabpro-ws` service is not running `ws-server/server.ts` at all — it is running a stale build of the Next.js web app (`prisma db push --accept-data-loss && next start`). `GET https://collabpro-ws-production.up.railway.app/health` returns Next.js HTML with a 404, not the WS server's health JSON. Every client silently falls back to 4-second HTTP polling.
3. **That fallback polling is the dominant load driver.** `useQuery` polls `/api/state-sync` every 4s, and `files:getFileById` / `files:getFiles` return full `document` and `whiteboard` blobs uncached (Redis is unconfigured on web, so `cacheAside` always misses). Every open tab pulls the entire workspace payload from Postgres 15 times a minute.

Under that sit ~25 further findings across architecture, data, code and infra, catalogued below.

---

## 1. Critical — fix this week

### C1. Forgeable session tokens (auth bypass)
`lib/session-auth/jwt.ts:3` — `process.env.SESSION_SECRET || 'super-secret-collabpro-key-12345678-abcdefgh'`. `railway variables --service collabpro` shows **no `SESSION_SECRET`**. The fallback is public. Forging `signToken({id, email, name})` yields a session for any account. `verifyToken` also accepts tokens with no `exp` claim, so a forged token never expires.

**Fix:** generate a 32+ byte random secret, set it on both `collabpro` and `collabpro-ws`, **then** merge PR #178 (which makes the secret mandatory and adds `iat`/`exp`). Order matters — see §5.

### C2. WS service is running the wrong process
Railway `collabpro-ws` is builder `RAILPACK` with `NIXPACKS_START_CMD=npm run ws:start`. Railpack does not honour `NIXPACKS_*`; the deployed container (from 2026-07-12) runs the Next app instead. Consequences: no WebSocket upgrade, no presence, no cursors, no live sync — and the stale start command runs **`prisma db push --accept-data-loss` against the production database on every container boot**.

**Fix:** point the service at `ws-server/Dockerfile` (or set Railway's *Custom Start Command* field, not the env var), and redeploy. Verify `/health` returns `{"status":"ok","connections":N}`.

### C3. Share-link IDOR — any user can mint an editor link to any file
`app/api/share/route.ts` checks only that a session exists, never that the caller can access `fileId`:
- `POST` (line 68) creates or updates a `SharedLink` for **any** `fileId`, with `role: 'editor'` if asked.
- `POST` with `sharedLinkId` updates **anyone's** link.
- `GET ?fileId=` (line 18) lists all share links for any file.
- `DELETE` (line 123) revokes any link by id.

Combined with `/api/state-sync`'s guest path (route.ts:100–124), which grants write access on a valid editor link, this is unauthenticated-equivalent write access to every document in the system. **Fix:** add the same `checkFileAccess` used in `state-sync/route.ts` to all four handlers, plus an ownership check on `sharedLinkId`.

### C4. Share-link passwords are unsalted SHA-256
`app/api/share/route.ts:7` and `app/api/share/verify/route.ts:5`. Instant rainbow-table recovery. `/api/share/verify` is also unauthenticated and unthrottled, so the hash is brute-forceable online. **Fix:** bcrypt (already a dependency), plus rate-limit the verify endpoint.

### C5. `/api/admin/telemetry` is unauthenticated
`app/api/admin/telemetry/route.ts:7` has no session or role check despite the `admin` path, and the super-admin page polls it every 3 seconds. It also **fabricates** CPU, memory and network numbers with `Math.sin(Date.now())` and mock DB-pool counts (`lib/kafka.ts:200`) — an operator dashboard showing invented data is worse than no dashboard. **Fix:** require an admin session; replace the fabricated fields with real `process.memoryUsage()` / `pool.totalCount` or delete them.

### C6. CI security webhook falls back to a public default secret
`app/api/security-audit/route.ts:6` — `process.env.NOTIFICATION_SECRET || 'ci-secret-token'`, and `NOTIFICATION_SECRET` is not set on Railway. Anyone can flood the security-scan queue. **Fix:** fail closed when the env var is missing.

---

## 2. Architecture findings

### A1. The "CRDT" layer is not a CRDT
`lib/crdt.ts:7` builds a **brand-new `Y.Doc` from the full JSON state on every save**, then base64s `encodeStateAsUpdate`. There is no shared document, no persistent client IDs, no incremental updates, no awareness protocol. Merging two such updates (`Y.mergeUpdates`, ws-server/server.ts:98) merges two unrelated docs whose `Y.Array`s were each inserted at index 0 — producing duplicated and interleaved elements rather than convergence. Yjs is being used as an expensive serialization format that inflates every payload ~1.4x.

**Direction:** either adopt Yjs properly (`y-websocket` provider, persist `Y.Doc` binary, ship deltas) or drop it and keep JSON + the id-keyed element merge that already works. The half-measure costs bandwidth and delivers no conflict resolution.

### A2. Document merge concatenates blocks instead of merging by id
`app/api/state-sync/services/helpers.ts:76` `mergeDocumentBlocks` returns `[...currentBlocks, ...incomingBlocks]` with **no dedupe by `block.id`** — unlike `mergeWhiteboardById` two functions below, which does it correctly. Since Editor.js saves the whole document, every save appends a full copy. Today this is masked: documents are stored as `{yjs:true,...}`, so `asEditorDocument` throws and the merge silently degrades to last-write-wins (concurrent editors overwrite each other with no warning). The moment A1 is fixed and documents become plain JSON, this becomes live data corruption. **Fix both together.**

### A3. Four overlapping queue/transport systems, none fully wired
- **BullMQ** (`bullmq` dependency) — installed, never imported.
- **RabbitMQ** (`ws-server/server.ts:204`) — `RABBITMQ_URL` is set on **no** Railway service, so it defaults to `amqp://localhost:5672`, never connects, and `initRabbitMQ` retries every 5 seconds forever. Meanwhile the `rabbitmq` service is deployed and billing.
- **In-memory fake Kafka** (`lib/kafka.ts`) — unbounded arrays, never trimmed (memory leak), messages lost on restart, drives the fabricated telemetry.
- **ResilientQueue over Redis** (`lib/queue.ts`) — the only one that works, and only where Redis is configured.

This is issue #170. **Direction:** keep exactly one. Redis + BullMQ is the natural choice given Redis is already provisioned; delete the Kafka simulator and either wire or decommission RabbitMQ.

### A4. RabbitMQ has no volume — durable queue on ephemeral storage
The Railway `rabbitmq` service mounts no volume, yet `ws-server` publishes with `persistent: true` to a `durable: true` queue. If RabbitMQ were connected, every unflushed document/whiteboard write would be lost on restart. Currently moot only because A3 means it never connects.

### A5. Dual email/id foreign keys with no cutover (issue #175, PR #181)
`prisma/schema.prisma` now carries **both** `userEmail` (with a real FK) and a nullable `userId` on six tables, with two relations per model. No application code reads `userId`. The columns will drift the first time anyone changes an email. PR #181 is step 1 of 3 and shipping it alone makes the schema worse, not better.

Two concrete defects in PR #181:
- **`onDelete` mismatch:** the migration writes `ON DELETE CASCADE` (7 constraints) while `schema.prisma` declares `onDelete: SetNull`. Real behaviour would be *deleting a user cascades away their Teams and every File in them.* Prisma will also generate a corrective migration on the next `migrate dev`.
- **No baseline:** production was built with `prisma db push`, so `_init` will fail against the existing schema. The migration history needs `prisma migrate resolve --applied` before `migrate deploy` can ever run.

### A6. Two divergent copies of the same merge logic
`ws-server/server.ts:10–115` duplicates `parseJsonIfString` / `asEditorDocument` / `asWhiteboardElements` / `mergeDocumentBlocks` / `mergeWhiteboardById` from `app/api/state-sync/services/helpers.ts` — with subtle differences (`String(Math.random())` vs `crypto.randomUUID()` for ids; the WS copy returns `[]` where the API copy throws). Two code paths write the same column with different semantics. **Fix:** extract to `lib/` and import in both.

### A7. `db-prep.js` rewrites `schema.prisma` at build time (issue #174)
`scripts/db-prep.js` mutates the checked-in schema's `provider` and shells out to `prisma generate` during `predev`/`prebuild`. The schema is a build artifact that can end up dirty in git. Combined with SQLite-vs-Postgres dual adapters in `lib/db.ts`, dev and prod run different databases with different semantics. **Direction:** commit `provider = "postgresql"` permanently and run Postgres locally via the existing docker-compose.

---

## 3. Performance & cost bottlenecks

| # | Finding | Impact |
|---|---|---|
| P1 | `useQuery` polls every 4s (`lib/state-sync/react.tsx:502`) with WS down | Every tab = 15 req/min to `/api/state-sync` |
| P2 | `files:getFileById` returns full `document`+`whiteboard` blobs each poll | Hundreds of KB per request per user |
| P3 | `files:getFiles` (fileService.ts:109) returns **all** files with full blobs, no pagination, no field selection | Dashboard payload grows linearly with workspace size |
| P4 | Redis unconfigured on `collabpro` — no `REDIS_URL` | `cacheAside` always misses *and* attempts a localhost connect per call; `getCachedFile`'s 600s TTL never applies |
| P5 | `S3_ENDPOINT=https://minio-production-5074.up.railway.app` (public URL) | Every image upload/read leaves and re-enters Railway's network — latency + egress billing. Should be `http://minio.railway.internal:<port>` |
| P6 | No `.dockerignore`; no `output: 'standalone'` | `COPY . .` ships `node_modules`, `.next`, `coverage`, `dev.db`, `.git`; runner keeps all devDependencies (playwright, googleapis, vitest). Image is likely >1.5GB |
| P7 | `ws:start` runs `tsx ws-server/server.ts` | TypeScript transpiled at boot in production; slower cold start, higher RSS |
| P8 | `lib/kafka.ts` topic arrays never trimmed | Unbounded memory growth in the web process |
| P9 | `hasFileAccess` (ws-server:352) runs 2 queries **per cursor message** | Cursor broadcast is the highest-frequency path; should be cached per connection+room |
| P10 | `FileVersion` stores full document+whiteboard copies, no retention policy | Table grows without bound |
| P11 | `debouncedWrites` Map (fileService.ts:54) is per-process | Breaks the moment `collabpro` scales past 1 replica; also two concurrent requests can both seed from DB and double-merge |
| P12 | Missing indexes on hot columns: `File.teamId`, `File.createdBy`, `TeamMember.userEmail`, `FilePresence.lastSeenAt`, `Notification.userEmail` | Sequential scans on every access check |

---

## 4. Infrastructure findings (Railway)

**Topology:** 6 services — `collabpro` (web, Dockerfile), `collabpro-ws` (Railpack), `Postgres` 18, `Redis` 8.2.1, `rabbitmq` 3-management, `minio` — all 1 replica, all in `asia-southeast1-eqsg3a`.

| # | Finding |
|---|---|
| I1 | **No healthcheck path on any service.** Railway cannot tell ready from starting, so deploys drop traffic. `ws-server` already exposes `/health`; the web app has no equivalent |
| I2 | **No `drainingSeconds` / `overlapSeconds`** on `collabpro` or `collabpro-ws` (only Postgres has `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=60`). Deploys sever in-flight requests and every WebSocket |
| I3 | **Missing env vars:** `SESSION_SECRET` (both app services), `NOTIFICATION_SECRET`, `REDIS_URL` (web), `RABBITMQ_URL` (everywhere), SMTP vars (web) |
| I4 | **Unpinned images:** `minio/minio` (no tag), `rabbitmq:3-management`. Silent breaking upgrades on redeploy |
| I5 | **`rabbitmq` has no volume** (see A4) and is entirely unused — pure cost |
| I6 | **Single replica everywhere, one region.** No HA. `ws-server` keeps `activeConnections` in memory; the Redis pub/sub fan-out exists but is only correct once every replica shares Redis |
| I7 | **`minio` `MINIO_ADDRESS=":"`** is a vestigial/broken value; the start command already sets `--address :$PORT` |
| I8 | **No staging environment** — only `production` exists, so every change is validated in prod |
| I9 | `prisma db push --accept-data-loss` in a start command (see C2) — never acceptable against production |

---

## 5. Open PRs — assessment and merge order

| PR | Verdict |
|---|---|
| **#178** security: require SESSION_SECRET, JWT expiry | **Correct fix, dangerous to merge as-is.** `getSecret()` throws at request time; `middleware.ts` calls `verifyToken` on every `/dashboard` and `/workspace/*` request. With `SESSION_SECRET` unset on Railway, merging takes production down completely. **Set the Railway variable first.** Also note all existing sessions are invalidated (new secret + new `exp` requirement) — users will be logged out |
| **#179** CI/CD pipeline | Good structure (split lint/build/test, `permissions: contents: read`, `persist-credentials: false`). But it **deletes** the Playwright E2E run, YouTube upload, security webhook and notification email, and **conflicts with #178** — both rewrite `ci.yml`. Decide whether those steps are being retired or moved; rebase one onto the other |
| **#180** WS hardening | Solid: real error logging replacing silent catches, `queueDbWrite` now returns the direct-save promise (fixes phantom saves), role check for viewers. **Two problems:** (a) it compares `conn.user.id !== senderEmail` where the publisher still sends `senderEmail: user.email` — the sender-exclusion check now never matches, so publishers echo events back to themselves; (b) it references a `writeClient` that is declared but never initialised in `ws-server/server.ts:140`, so the idempotency markers are permanently no-ops |
| **#181** FK migration (current branch) | Structurally sound migration, but see A5 — `onDelete` mismatch with the schema, no baseline for a `db push`-created production DB, and no application-code cutover. Do not deploy until the resolve step and code migration are planned |
| **#182** rate limiter | Reasonable in-memory limiter, correct semantics. Caveats: per-process (breaks at >1 replica — fine today, not after I6), and it commits a stray `.kilo/plans/1784867601541-*.md` artifact that should be dropped |

**Recommended order:** set Railway env vars → #178 → #182 → #180 (with the two fixes) → resolve #179/#178 CI conflict → #179 → #181 last, behind a baseline plan.

---

## 6. Code quality & testing

- **Coverage config excludes `app/api/**`** (`vitest.config.mts:24`) — every authorization check, the entire `state-sync` router, and all auth routes are outside the coverage measurement. This is the highest-risk code in the repo.
- **`npm audit`: 17 vulnerabilities (5 high)** — `sharp <0.35.0` (libvips CVEs), `valibot <=1.4.1`. Most fixable with `npm audit fix`.
- **`middleware.ts:9`** redirects unauthenticated users but returns nothing on success — works by accident. Should return `NextResponse.next()` explicitly.
- **`next.config.mjs:3`** sets `reactStrictMode: false`, hiding effect-cleanup bugs — relevant given the number of `setInterval`/`setTimeout` in `state-sync/react.tsx`.
- **`next.config.mjs:5`** uses the deprecated `images.domains`; should be `remotePatterns`.
- **`lib/db.ts`** logs the first 50 chars of `DATABASE_URL` on every cold start (line 16) — that includes the username and the start of the password.
- **`lib/db.ts:62`** sets pool `max: 50` **per instance** and appends `connection_limit=50`; Railway Postgres defaults to ~100 total connections. Two services at 50 each will exhaust it.
- **`app/api/upload/route.ts:141`** accepts any buffer containing `<svg` as a valid image, then only blocks `<script`. `onload=`, `<foreignObject>` and `<use href="data:">` still pass — stored XSS if SVGs are ever served inline rather than as downloads.
- **`mapConvexIds`** is duplicated in `helpers.ts:5` and `ws-server/server.ts:713`, and iterates `getOwnPropertyNames` **and** `for...in` over every object on every response — measurable overhead on large file payloads.

---

## 7. Prioritized plan

### Phase 0 — stop the bleeding (day 1, no code changes)
1. `railway variables --set SESSION_SECRET=$(openssl rand -hex 32)` on `collabpro` **and** `collabpro-ws`; same for `NOTIFICATION_SECRET`.
2. Set `REDIS_URL` on `collabpro` (internal host).
3. Repoint `S3_ENDPOINT` to `minio.railway.internal`.
4. Fix the `collabpro-ws` service to actually run `ws-server/Dockerfile`; verify `/health`.
5. Remove `prisma db push --accept-data-loss` from any start command.

### Phase 1 — close the security holes (week 1)
6. Merge #178 (after step 1), then #182.
7. Add `checkFileAccess` + ownership checks to all four `/api/share` handlers (C3).
8. Move share-link passwords to bcrypt; rate-limit `/api/share/verify` (C4).
9. Add an admin guard to `/api/admin/telemetry`; delete the fabricated metrics (C5).
10. `npm audit fix`; re-run Snyk.

### Phase 2 — make deploys safe (week 2)
11. Healthcheck paths on `collabpro` (`/api/health`, needs writing) and `collabpro-ws` (`/health`).
12. `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=60` + overlap on both app services.
13. Add `.dockerignore` and `output: 'standalone'`; compile `ws-server` with `tsc` instead of running `tsx`.
14. Pin `minio` and `rabbitmq` image tags.
15. Create a `staging` environment; resolve the #178/#179 CI conflict and merge #179.

### Phase 3 — fix the data model (weeks 3–4)
16. Baseline the production DB: `prisma migrate resolve --applied 20260723204037_init`.
17. Correct the `onDelete` mismatch in #181's migration to match `schema.prisma`.
18. Migrate application code to read `userId`, backfill, then drop the `userEmail` FKs — the two phases #181 is missing.
19. Add the missing indexes (P12).
20. Add a `FileVersion` retention policy.

### Phase 4 — fix collaboration properly (weeks 4–6)
21. Decide on A1: real Yjs (`y-websocket` + binary persistence + deltas) or plain JSON. Do not stay in between.
22. Fix `mergeDocumentBlocks` to dedupe by block id (A2) — must land with 21.
23. Extract the duplicated merge helpers into `lib/` (A6).
24. Collapse the four queue systems to one (A3); delete `lib/kafka.ts`; decommission or properly wire + volume RabbitMQ (A4).
25. Cache `hasFileAccess` per connection+room (P9).
26. Paginate `files:getFiles` and stop returning blobs in list views (P3).
27. Move rate limiting and `debouncedWrites` to Redis so >1 replica becomes safe (P11), then scale replicas (I6).

### Phase 5 — quality baseline (ongoing)
28. Remove the `app/api/**` coverage exclusion and write authorization tests.
29. Re-enable `reactStrictMode`.
30. Commit `provider = "postgresql"` and retire `db-prep.js` (A7).
