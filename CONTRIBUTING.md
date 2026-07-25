# Contributing to CollabPro

Thanks for taking the time to contribute! This document describes the workflow this repository actually uses.

## Workflow

1. **Open an issue first.** Every change ships through an issue — bug report or feature request — so intent and scope are recorded before code changes. `npm run resolve-issue` is an interactive CLI that walks you through picking an open issue, creating a branch, and raising the PR.
2. **Branch off `main`.** Use a descriptive name, e.g. `feature/issue-123-short-description` or `fix/issue-123-short-description`. There are no direct pushes to `main` — every change goes through a pull request.
3. **Make your change.**
   - Run `npx tsc --noEmit` and `npx vitest run` locally before pushing.
   - A `pre-push` git hook (installed automatically via `npm install`, see `scripts/install-hooks.js`) runs `npm run lint` and `npm run build` and blocks the push if either fails — don't bypass it with `--no-verify`.
4. **Open a pull request.** CI runs `build`, `lint`, `test`, `embed-diagrams`, a Snyk security scan, an E2E/showcase run, and two AI reviewers (CodeRabbit, cubic). All checks must pass before merge.
5. **Merge.** Once CI is green and review feedback (if any) has been addressed, merge with "Create a merge commit" and delete the branch.

## Local setup

See the [Getting Started](README.md#-getting-started) section of the README for environment setup (`.env`, `docker-compose up -d postgres redis`, `npx prisma migrate dev`, `npm run dev` + `npm run ws:start`).

## Code style

- TypeScript, strict mode. Avoid `any` and non-null assertions (`!`) — prefer real type narrowing.
- No speculative abstractions: prefer the smallest change that solves the actual problem in the issue.
- Prisma schema changes go through `npx prisma migrate dev --name <description>` so a migration file is committed alongside the schema change — never `prisma db push` for anything that needs to reach production (see [`docs/architecture.md`](docs/architecture.md) for why).

## Reporting bugs vs. security issues

Regular bugs: open a GitHub issue. Security vulnerabilities: see [`SECURITY.md`](SECURITY.md) instead — please don't open a public issue for those.
