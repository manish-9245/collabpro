# Data Architecture Review Findings

## Intake Summary
**Reviewer:** Data Architect
**Date:** 2026-07-18
**Target:** /Users/manishtiwari/Documents/erasor_clone

## Executive Summary
The system successfully implements a standalone WebSocket real-time engine and database agnosticism through Prisma. Caching is robustly handled via Redis Cache-Aside strategies. However, the data architecture suffers from critical referential integrity issues at the database schema level and significant data-loss risks during concurrent real-time editing due to a "last-writer-wins" approach. Additionally, the fallback HTTP polling mechanism violates the stated backoff SLO.

## Key Findings

### Critical
1. **Missing Database Referential Integrity:** The Prisma schema (`prisma/schema.prisma`) lacks native relational definitions (e.g., `@relation`). Foreign keys (like `File.teamId` -> `Team.id`, `TeamMember.teamId` -> `Team.id`) are modeled as plain `String` fields. This completely circumvents database-level referential integrity and cascading deletes, introducing a severe risk of orphaned records and data anomalies.
2. **State Synchronization Data Loss (Last Writer Wins):** Real-time collaboration updates for the markdown document and whiteboard (via WebSockets `executeMutation` and `FileService.updateFile`) directly overwrite the target fields using `prisma.file.update`. There is no CRDT merging or Optimistic Concurrency Control (OCC) utilized in these primary paths. This will guarantee lost updates during concurrent edits. (While an OCC-based `collabpro_update_document` exists in the API, it is bypassed by the WebSocket server and standard mutations).

### High
3. **Polling Backoff Implementation Mismatch:** The system SLO strictly mandates "Zero-latency resumption from backoff polling (15s to 4s)". However, in `lib/state-sync/react.tsx`, the `useAdaptiveInterval` hook initializes `backoffInterval` to `60000ms` (60 seconds) during inactivity, and `300000ms` (5 minutes) during tab blur. This directly violates the 15-second backoff SLO.

### Medium
4. **Missing Indexes on Foreign Keys:** Due to the absence of defined Prisma relations, crucial indexes for high-frequency queries are missing. Queries filtering by `teamId` on the `File` and `TeamMember` tables will result in sequential table scans, degrading performance as the dataset scales.
5. **Inefficient Large Payload Storage:** The `UploadedFile.payload` field in the Prisma schema is modeled as a `String`. Storing large files (likely base64 encoded) directly in PostgreSQL string columns leads to database bloat, TOAST table overhead, and reduced query performance.

### Low
6. **Incomplete use of FileVersion schema:** A `FileVersion` model exists in the Prisma schema to track document history, but the real-time WebSocket server does not write to this table when flushing durable updates via RabbitMQ (`initRabbitMQ` consumer), effectively rendering the history tracking incomplete or non-functional.

## Recommendations
- **Enforce Referential Integrity:** Refactor `schema.prisma` to use explicit `@relation` directives for all relational fields (e.g., `Team`, `User`, `File`, `TeamMember`). This ensures DB-level cascading deletes and structural consistency.
- **Implement OCC / CRDT for Real-Time Sync:** Modify the WebSocket server (`ws-server/server.ts`) and `FileService` to utilize version-based Optimistic Concurrency Control (e.g., the unused `collabpro_update_document` logic) or native CRDT algorithms (like Yjs) rather than blindly overwriting the `document` and `whiteboard` payloads.
- **Fix Polling SLO:** Update `useAdaptiveInterval` in `lib/state-sync/react.tsx` to align with the documented SLO: backoff to `15000` (15s) instead of 60s/300s.
- **Add DB Indexes:** explicitly add `@@index([teamId])` and similar necessary compound indexes to high-traffic tables.
- **Migrate Blob Storage:** Transition `UploadedFile.payload` out of the relational database and into the configured S3/MinIO object storage, saving only object references/URLs in PostgreSQL.
