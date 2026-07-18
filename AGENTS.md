# CollabPro - Developer Agent Blueprint

This file outlines the absolute guidelines, architecture shortcuts, and safety guardrails for AI agents developing on **CollabPro**. Follow this blueprint to resolve issues cleanly and rapidly.

---

## ⛔ ZERO-TOLERANCE GUARDRAILS
1. **NO DIRECT PUSHES TO MAIN:** Direct pushes to `main` are strictly blocked. You must commit and push all edits to a dedicated feature branch: `feature/issue-<number>`.
2. **ZERO BUILD FAILURES:** You must run and verify a clean compilation (`npm run build`) before pushing. Exit Code must be **0**.
3. **STRICT DB AGNOSTICISM:** Do not write engine-specific Prisma fields (e.g., PostgreSQL `@db.Uuid` or arrays `String[]`). All database models inside `prisma/schema.prisma` must remain relational-generic.
4. **PIPELINE INTEGRITY VERIFICATION:** You must programmatically verify that both the GitHub Actions CI pipeline and the Railway production deployment pipeline are fully green, active, and successful post-push/post-merge. Execute the verification script to validate both systems: `npm run verify-pipelines`.
5. **MANDATORY REVIEW OF AI BOT REVIEWS (Cubic Dev & CodeRabbit):** Before performing any merge to `main`, you must proactively fetch, review, and address comments from Cubic Dev (`cubic-dev-ai[bot]`) and CodeRabbit. Any valid security (P1/P2), concurrency, or transactional integrity issues must be fully fixed and pushed to the branch first.

---

## 🏗️ WORKSPACE BLUEPRINT (DEVELOP QUICKER)
* **Web Framework:** Next.js 14 App Router. Page routes reside inside `app/(routes)/`.
* **Session Auth:** Natively handled locally in cookie sessions via `lib/session-auth/` backed by SQLite/PostgreSQL. No third-party Auth SaaS (e.g., Clerk, Kinde) is used.
* **Database ORM:** Prisma Client.
* **Dynamic Database Adapter:** 
  - [`lib/db.ts`](file:///Users/manishtiwari/Documents/erasor_clone/lib/db.ts) instantiates the optimized PG adapter **only** if database scheme is postgresql. Otherwise, it defaults to a standard direct client.
  - [`scripts/db-prep.js`](file:///Users/manishtiwari/Documents/erasor_clone/scripts/db-prep.js) runs automatically on `predev` and `prebuild` hooks to detect the provider from your active `DATABASE_URL` and rewrite `prisma/schema.prisma` on-the-fly.

---

## ⚡ RESOLUTION RECIPE (SOLVE QUICKER)

### Step 1: Setup Branch
Always run on a dedicated branch from a fresh pull of `main`:
```bash
git checkout main && git pull origin main
git checkout -b feature/issue-<number>
```

### Step 2: Surgical Context Scouting
* Do not read entire files. Use targeted search queries to pinpoint the target code:
  ```bash
  # Find canvas or excalidraw components
  grep_search SearchPath="./app" Query="Excalidraw"
  ```

### Step 3: Minimal Impact Edits
* Apply edits using `replace_file_content` chunks. Avoid re-writing or bloating code files.
* Ensure strict TypeScript safety. Never bypass type assertions or write `any` types.

### Step 4: Verification Build
```bash
npm run build
```

### Step 4.5: AI Code Review Assessment (Cubic Dev & CodeRabbit)
* Proactively fetch automated reviews, security warnings, and transactional feedback raised on the PR by `cubic-dev-ai[bot]` and `CodeRabbit`.
* Interrogate and categorize findings:
  - **P1/P2 Security & Integrity issues** (e.g. Broken Object Level Authorization, race conditions, seat limit bypasses) must be resolved immediately via local patches, verified with unit tests, and pushed.
  - Reject incorrect or non-applicable recommendations, providing clear technical reasons.

### Step 5: Automated PR Submit
Stage, commit, and push your changes to `origin`, then generate a clean PR:
```bash
git add -A
git commit -m "feat(issue-<number>): concise conventional description"
git push origin feature/issue-<number>
gh pr create --title "feat(issue-<number>): concise title" --body "### Technical Changes\n- ...\n\n### Verification Done\n- Passed 'npm run build'"
```
* **Post-Submit Cleanup & Switch:** Switch back to `main` safely:
  ```bash
  git checkout main
  ```
* **Post-Merge Verification:** Once merged to `main`, programmatically verify both GitHub Actions CI and Railway deployment health states:
  ```bash
  npm run verify-pipelines
  ```

---

## Agent skills

### Issue tracker

Issues and PRDs are tracked using GitHub issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Using the canonical triage label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo layout with `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
