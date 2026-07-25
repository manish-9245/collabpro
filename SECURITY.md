# Security Policy

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, use GitHub's [private vulnerability reporting](https://github.com/manish-9245/collabpro/security/advisories/new) for this repository. Include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce (a minimal repro is ideal).
- The affected version/commit, if known.

We aim to acknowledge reports within a few days and will keep you updated as a fix is developed.

## What's already in place

- Every pull request runs a Snyk dependency scan (`security/snyk` check) — a PR with a new high/critical-severity vulnerability fails CI and cannot be merged.
- Sessions are signed JWTs (`SESSION_SECRET`, required at boot — the app will not start without it) rather than a third-party auth provider.
- Auth endpoints (login, register, share-link verification) are rate-limited (see [`lib/rate-limiter.ts`](lib/rate-limiter.ts)) against credential stuffing and brute force.
- Admin-only routes (e.g. `/api/admin/telemetry`) use an explicit operator-managed email allowlist (`ADMIN_EMAILS`) and fail closed when unset.

## Supported versions

This project does not currently maintain multiple release branches — only the latest commit on `main` receives security fixes.
