# Architecture Review: CollabPro (Software Engineering Perspective)

## Executive Summary
CollabPro successfully implements a robust, self-contained, real-time collaboration environment with a dual-node architecture (Next.js 15 for HTTP/React and a standalone Node.js WebSocket Gateway). The system adheres strictly to the "Zero SaaS Dependency" requirement, utilizing local fallbacks for S3 and custom DB-agnostic ORM implementations. The real-time engine scales well with Redis Pub/Sub and RabbitMQ. However, significant concerns exist regarding code maintainability within the API layer and severe cryptographic vulnerabilities in the custom session authentication mechanism.

## System Strengths (What works well)
- **Zero SaaS Adherence:** Authentication, Database, and Storage all have local, self-hosted implementations (e.g., `app/api/upload/route.ts` falls back to Base64 DB storage if S3 is unavailable).
- **Fault-Tolerant State Sync:** The custom `ws-client` uses IndexedDB (`idb`) for offline mutation queueing and implements HTTP Adaptive Polling as a fallback if WebSockets fail.
- **Horizontal Scalability:** The `ws-server` integrates `ioredis` for Pub/Sub horizontal scale and `amqplib` for durable background database writes to prevent UI blocking.
- **Build Integrity:** Automated CI/CD pipelines correctly utilize service containers to pass Playwright testing and zero-failure compilation rules.

## Key Findings

### Critical
1. **Unsigned Plaintext Session Cookies:** The custom session auth in `app/api/auth/login/route.ts` stringifies the user object into a plaintext `session_token` cookie without any cryptographic signature (JWT) or encryption. This allows trivial spoofing/impersonation. Furthermore, passwords are obfuscated via direct plaintext comparison.
2. **The "God Function" API Route:** `app/api/state-sync/route.ts` is an unmaintainable ~1300-line monolithic handler. It uses a single massive `switch (path)` statement to route every read and mutation in the application, violating Separation of Concerns and Single Responsibility principles.

### High
3. **Next.js Version Discrepancy:** The `README.md`, `AGENTS.md`, and intake documentation specify Next.js 14 (App Router). However, `package.json` mandates Next.js `^15.5.20` and React 19. This discrepancy introduces risks of assuming Next.js 14 caching semantics in a Next.js 15 runtime environment.

### Medium
4. **Dynamic Schema Mutability:** The `scripts/db-prep.js` file rewrites `prisma/schema.prisma` inline on every build/dev execution. While this intelligently satisfies the database agnosticism requirement (swapping SQLite vs PostgreSQL dynamically), it risks leaving dirty Git working trees and race conditions in concurrent CI tasks.

### Low
5. **Redundant Presence Heartbeats:** Client-side presence intervals fire constantly at 5-second intervals. While adaptive backoff (to 45s) exists for idle users, a persistent high frequency could still overwhelm the WebSocket Gateway at high concurrent capacities.

## Recommendations
1. **Immediate Security Patch:** Implement `iron-session` or `jose` for secure, tamper-proof encrypted cookies. Add `bcrypt` or `argon2` for password hashing.
2. **Refactor API Layer:** Decompose `app/api/state-sync/route.ts` into a domain-driven structure (e.g., `user.controller.ts`, `team.controller.ts`) and use an RPC router pattern (like tRPC or standard Next.js Route Handlers) instead of a manual switch block.
3. **Align Dependencies:** Either downgrade the framework to Next.js 14 to match the SLO/SLI documentation or update the architectural blueprints to officially support Next.js 15 and React 19.
