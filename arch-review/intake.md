# Intake Summary

**Target:** /Users/manishtiwari/Documents/erasor_clone
**Date:** 2026-07-18
**Reviewer:** Review Lead (Architecture Review Team)

## System Description
CollabPro is a premium, open-source collaborative whiteboard and system design workspace. It features a real-time Markdown document editor alongside an infinite collaborative engineering canvas. It supports file/folder navigation, multi-tenant team security, and real-time collaboration. The system is engineered to be 100% self-contained with zero external SaaS dependencies.

## Tech Stack
- **Frontend:** Next.js 14 (App Router), React 19, Tailwind CSS, Lucide Icons
- **Real-Time Engine:** Node.js standalone WebSockets Gateway (`ws`) on Port 3001
- **Database & ORM:** Prisma Client, PostgreSQL (with local SQLite support fallback)
- **Document/Canvas:** Editor.js, @excalidraw/excalidraw
- **CI/CD & Testing:** GitHub Actions, Playwright, Vitest, Docker
- **Auth:** Custom secure session-cookie authentication engine

## Documentation Quality
- High quality `README.md` explaining architecture topology, caching, and state synchronization.
- Development blueprints in `AGENTS.md` specifying CI rules and framework mandates.
- Found `docs/deploy-k8s.md` for deployment.

## Stated Requirements and SLOs
- **Zero SaaS Dependencies:** Must not rely on third-party auth (Clerk/Kinde) or DB (Convex).
- **Latency & Sync:** WebSocket-first topology with HTTP Adaptive Polling fallback. Zero-latency resumption from backoff polling (15s to 4s).
- **DB Agnosticism:** Prisma models must remain relational-generic (no DB-specific types like `@db.Uuid`).
- **Zero Build Failures:** Any push must pass `npm run build` with exit code 0.

## Review Scope
Full architecture review across 9 domains (Solutions, Data, Integration, Software Engineering, Performance, QA, Security, Platform, Risk & Compliance).

## Pre-existing Known Issues
None explicitly documented in top-level README, but strict guardrails are enforced against direct pushes to main and DB specific Prisma fields.
