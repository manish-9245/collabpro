# Plan: Fix All PR Review Comments

## Overview

Five open PRs have review comments from **CodeRabbit** and **Cubic Dev AI** that must be resolved before merge. This plan covers every actionable finding, organized by PR, with priorities and validation steps.

---

## PR #182 — Rate Limiter (`feature/issue-176-177`)

### File: `lib/rate-limiter.ts` (new file created by PR)

**Cubic Dev P2 — Interval cleanup leak** (`lib/rate-limiter.ts:8`)
- **Root cause:** Module-level `setInterval` is registered at import time. During Next.js HMR in dev, the module is re-evaluated and a new 60s timer accumulates without clearing the previous one.
- **Fix:** Export a `startCleanup()` / `stopCleanup()` pair, or store the interval handle in a module-level variable so tests and HMR can clean it up. Alternatively, lazily initialize the interval and expose a cleanup function.

**Cubic Dev P1 — Rate limiter not wired into auth routes** (`lib/rate-limiter.ts:27`)
- **Root cause:** `checkRateLimit` is exported but never called in `app/api/auth/login/route.ts` or `app/api/auth/register/route.ts`.
- **Fix:** Import `checkRateLimit` and `LIMITS` in both route files. Before credential processing, call `checkRateLimit(ipOrEmail, LIMITS.LOGIN)` (or `LIMITS.REGISTER`). If `allowed` is `false`, return `NextResponse.json({ error: 'Too many attempts' }, { status: 429 })`.

---

## PR #181 — Foreign Key Migration (`feature/issue-175`)

### File: `prisma/migrations/20260723204037_init/migration.sql`

**Cubic Dev P0 — PostgreSQL-incompatible DDL** (`migration.sql:15`)
- **Root cause:** Migration uses SQLite `DATETIME` type but schema is PostgreSQL-configured. Also uses SQLite migration lock.
- **Fix:** Generate a PostgreSQL-specific migration (`DATETIME` → `TIMESTAMP` or rely on Prisma default) and use a PostgreSQL migration lock (`prisma/migrations/migration_lock.toml` with `postgresql` provider).

**Cubic Dev P1 — `Team.createdBy` is a free-form string** (`migration.sql:22`)
- **Root cause:** `Team.createdBy` has no FK constraint, so team ownership is not enforced.
- **Fix:** Add a `userId` column to `Team` with a FK to `User.id`, update `prisma/schema.prisma` to reflect the relation, and backfill existing rows.

### File: `prisma/migrations/20260723204037_migrate_fk_to_user_id/migration.sql`

**Cubic Dev P1 — SQLite-incompatible ALTER TABLE** (`migration.sql:3`)
- **Root cause:** Uses `ALTER TABLE ... ADD CONSTRAINT` which SQLite does not support.
- **Fix:** Rewrite as SQLite-compatible table recreation (create new table, copy data, drop old, rename) or use a provider-specific migration strategy. Since `db-prep.js` rewrites schema at runtime, ensure migrations are generated per-provider.

**Cubic Dev P1 — Schema drift** (`migration.sql:12`)
- **Root cause:** Migration adds columns not present in `prisma/schema.prisma`, so Prisma Client has no typed access.
- **Fix:** Update `prisma/schema.prisma` simultaneously: add `userId` fields to `TeamMember`, `FilePresence`, `Invitation`, `Notification`, and `ApiKey` models with proper `@relation` to `User.id`.

**Cubic Dev P1 — Missing data backfill** (`migration.sql:22`)
- **Root cause:** New nullable `userId` columns are added but never populated from existing `userEmail` references.
- **Fix:** Add `UPDATE` statements before/after adding columns to populate each new `userId` by joining on the existing `userEmail` column.

---

## PR #180 — WebSocket Server Hardening (`feature/issue-168-172-173`)

### File: `ws-server/server.ts`

**CodeRabbit — Redact `user.email` from rejection logs** (around line 564–567)
- **Root cause:** Mutation auth rejection logs raw `user.email`, leaking PII.
- **Fix:** Replace `user.email` in the rejection log with a redacted identifier (e.g., user id hash) or remove the identifier entirely. Preserve the authorization error and mutation details.

**CodeRabbit — Restore queue-based serialization** (around line 296–307)
- **Root cause:** `queueDbWrite` marks messages with `directWriteDone: true`, causing the consumer to skip persistence. It also always calls `executeSave`, removing RabbitMQ write serialization.
- **Fix:** Remove `directWriteDone: true` from the payload. In `queueDbWrite`, publish to the queue and return without calling `executeSave` when publish succeeds. Keep `executeSave` as fallback only when `mqChannel` is absent or publishing fails. Ensure the consumer does the merge + `prisma.file.update` + `ack` after persistence.

**Cubic Dev P0 — Authorization binds to wrong file ID** (line 564)
- **Root cause:** `checkMutationAuth` uses `targetRoom` (from `fileId || args._id`) but `executeMutation` uses `args._id`. A client can send mismatched `fileId` and `args._id` to authorize one file and write another.
- **Fix:** In the mutation handler, derive the authorized file ID from `args._id` (the ID consumed by `executeMutation`), not from the client-supplied `fileId`. Reject when they differ.

**Cubic Dev P1 — Lost-update race condition** (line 307)
- **Root cause:** Concurrent mutations each independently do `findUnique` → merge → `update` with no coordination.
- **Fix:** After restoring queue-based serialization (consumer does the write), add per-file locking (e.g., a Redis lock keyed on `fileId`) around the consumer's read-modify-write cycle. The queue already serializes messages globally; the lock ensures only one consumer processes a given file at a time.

**Cubic Dev P2 — Duplicate mutation on HTTP fallback timeout** (line 669)
- **Root cause:** When a DB write exceeds the client's socket timeout, a fallback HTTP path retries the same mutation, duplicating blocks.
- **Fix:** Add a request-id / mutation-id to each WebSocket mutation message. Before processing, check if the mutation id was already applied (e.g., store processed ids in a short-lived Redis set). Skip or return cached result for duplicates.

**Cubic Dev P3 — Dead shared-link code in `checkMutationAuth`** (line 405)
- **Root cause:** `hasFileAccess` only returns true for creators or team members, so the shared-link branch is unreachable.
- **Fix:** Either remove the dead shared-link block and fallthrough return, or extend `hasFileAccess` (or create a separate `hasSharedLinkAccess`) to include shared-link users so they reach the role validation. If shared-link write enforcement is intended, implement it properly; otherwise remove the misleading code.

**Cubic Dev P1 — Mutation lost on crash after publish** (line 299)
- **Root cause:** If the process crashes after publishing but before the consumer processes, the message is durable but no one may process it if the consumer was also down.
- **Fix:** This is partially addressed by restoring queue-based serialization with consumer-side persistence + ack. Ensure the consumer is started at boot and reconnects on failure. The existing `initRabbitMQ` reconnect logic handles this.

---

## PR #179 — CI/CD Pipeline (`feature/issue-169`)

### File: `.github/workflows/ci.yml`

**CodeRabbit / Cubic Dev P2 — Add `permissions` block** (line 13)
- **Root cause:** No `permissions:` block at workflow or job level, so `GITHUB_TOKEN` inherits broad default scopes.
- **Fix:** Add at workflow level (before `jobs:`):
  ```yaml
  permissions:
    contents: read
  ```

**CodeRabbit / Cubic Dev P2 — Add `persist-credentials: false`** (line 35)
- **Root cause:** `actions/checkout@v4` persists `GITHUB_TOKEN` in `.git/config`. `npm ci` then runs arbitrary `postinstall` scripts from dependencies, which could exfiltrate the token.
- **Fix:** In all three checkout steps (build, lint, test), add:
  ```yaml
  with:
    persist-credentials: false
  ```

---

## PR #178 — Security Fixes (`feature/issue-168-177`)

### File: `lib/session-auth/jwt.ts`

**Cubic Dev P1 — Reject tokens without `exp`** (line 78)
- **Root cause:** Current check `if (payload.exp && ...)` skips validation when `exp` is missing, `null`, or `0`, allowing indefinite validity for pre-existing tokens.
- **Fix:** Replace with:
  ```typescript
  if (typeof payload.exp !== 'number' || Date.now() / 1000 >= payload.exp) {
    return null;
  }
  ```

**Cubic Dev P2 — Reject at `exp`, not after** (line 78)
- **Root cause:** Equality (`Date.now() / 1000 > payload.exp`) treats tokens as valid at exactly `exp`.
- **Fix:** Use `>=` instead of `>`.

**Cubic Dev P2 — Add `iat` / `exp` validation** (lines 74–80)
- **Root cause:** `iat` and `exp` are not validated as finite numbers.
- **Fix:** After parsing the payload, validate `iat` and `exp` are finite numbers. Reject if not.

**Cubic Dev P2 — Align session cookie `maxAge` with JWT expiry** (lines 46–47)
- **Root cause:** JWT expires after 24h but `session_token` cookie `maxAge` is 7 days in `app/api/auth/login/route.ts` and `app/api/auth/register/route.ts`. Users lose sessions silently after 24h while the browser sends stale cookies for 6 more days.
- **Fix:** Change `maxAge: 60 * 60 * 24 * 7` to `maxAge: 60 * 60 * 24` (24 hours) in both login and register routes. Alternatively, implement token refresh/rotation.

**CodeRabbit — Type safety for payload** (lines 44–45)
- **Root cause:** `verifyToken` returns `any`; `signToken` payload is `object`.
- **Fix:** Define a `SessionTokenPayload` interface. Change `verifyToken` return type to `SessionTokenPayload | null`. Validate parsed payload fields before returning. Remove unnecessary `as object` cast in `signToken`.

### File: `scripts/upload-youtube.js`

**Cubic Dev P2 — Preserve full error context** (line 105)
- **Root cause:** PR changed `console.error('❌ Error uploading video to YouTube:', err)` to `err.message`, stripping status code and error details.
- **Fix:** Log the full error object: `console.error('❌ YouTube upload failed:', err)` and add supplementary context lines for common causes.

### File: `.github/workflows/ci.yml`

**CodeRabbit / Cubic Dev P2 — Dynamic Playwright Audit status** (line 248)
- **Root cause:** Playwright Audit row hardcodes `Passed (Showcase Video Outputted)` but the email fires on `if: always()`, so failed runs show contradictory status.
- **Fix:** Derive from step outcome:
  ```yaml
  ${{ steps.playwright_tests.outcome == 'success' && 'Passed' || 'Failed' }}
  ```

**Cubic Dev P1 — Broken unsubscribe link** (line 309)
- **Root cause:** `{{unsubscribe_url}}` renders as literal text; GitHub Actions expressions require `${{ }}` and no such variable exists.
- **Fix:** Remove the literal placeholder. Use the `dawidd6/action-send-mail` `list_unsubscribe` input or omit the link until a real endpoint exists.

### File: `lib/notification-queue.ts`

**Cubic Dev P2 — XSS via unescaped payload interpolation** (line 104)
- **Root cause:** `payload.repository`, `payload.branch`, `payload.author`, and `payload.commit` are interpolated directly into HTML without escaping.
- **Fix:** Escape all dynamic values before interpolation. Add a simple `escapeHtml` helper. Validate payload schema at ingress.

**Cubic Dev P3 — Dead dark-mode CSS** (line 115)
- **Root cause:** Dark-mode CSS classes (`.dark-bg`, `.dark-card`, etc.) are defined but never applied to elements.
- **Fix:** Apply the dark-mode classes to corresponding elements, or remove the unused `@media (prefers-color-scheme: dark)` block.

**Cubic Dev P2 — Unsafe `.substring` on malformed payload** (line 177)
- **Root cause:** `payload.commit.substring(0, 12)` crashes if `commit` is missing or non-string.
- **Fix:** Add a runtime guard: `const safeCommit = typeof payload.commit === 'string' ? payload.commit.substring(0, 12) : 'unknown'`. Or validate the full payload schema before processing.

**Cubic Dev P2 — Invalid Outlook conditional markup** (line 225)
- **Root cause:** The `<!--[if mso]>` conditional opens a `<tr>` but no `<td>` before the nested table, causing Outlook rendering issues.
- **Fix:** Wrap the inner table in a conditional `<td>` and close it in the matching conditional block:
  ```html
  <!--[if mso]><tr><td><![endif]-->
  <table>...</table>
  <!--[if mso]></td></tr><![endif]-->
  ```

**Cubic Dev P2 — Literal `{{unsubscribe_url}}` in email** (line 267)
- **Root cause:** The HTML template contains `{{unsubscribe_url}}` which renders as literal text.
- **Fix:** Generate a per-recipient unsubscribe URL before sending, or remove the placeholder and use the mail action's `list_unsubscribe` input.

---

## Execution Order

1. **PR #179** (CI) — 2 small, low-risk fixes. Merge first.
2. **PR #182** (Rate Limiter) — Wire into auth routes + cleanup. Merge second.
3. **PR #178** (Security) — JWT, email, YouTube fixes. Merge third.
4. **PR #180** (WebSocket) — Most complex. Requires queue serialization restore + auth fix + idempotency. Merge fourth.
5. **PR #181** (FK Migration) — Highest risk due to schema + migration + backfill. Merge last after thorough testing.

## Validation

- After each branch fix: `npm run build` must pass.
- For PR #181: run `npx prisma migrate deploy` against both SQLite and PostgreSQL to verify migrations apply cleanly.
- For PR #180: run WebSocket integration tests verifying concurrent mutations to the same file do not clobber each other.
- For PR #182: verify rate limit returns 429 after 5 login attempts from the same IP within 15 minutes.
- Final step: `npm run verify-pipelines` after merging all PRs.
