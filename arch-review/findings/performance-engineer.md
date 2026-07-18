# Architecture Review: Performance Engineer Findings

## Intake Summary
**Target:** `/Users/manishtiwari/Documents/erasor_clone`
**Date:** 2026-07-18
**Reviewer:** Performance Engineer

## Summary
The CollabPro architecture relies on WebSockets for real-time state synchronization, supported by a RabbitMQ durable write queue and Redis for pub/sub. While the system claims zero latency and zero external dependencies, its current implementation of CRDT synchronization lacks debouncing and delta updates, creating a severe bottleneck. The frontend serializes and transmits the entire document/canvas state on every single keystroke. Furthermore, relational performance is compromised by widespread missing database indexes. 

## Key Findings

### Critical
1. **Zero-Debounce State Sync Loop (`Editor.tsx` & `Canvas.tsx`)**
   - **Issue:** The React components for Editor and Canvas trigger `updateDocument` and `updateWhiteboard` mutations on every keystroke/change (`onChange` in EditorJS and Excalidraw) without any debouncing. 
   - **Impact:** Each keystroke serializes the entire CRDT state, transmits it over WS/HTTP, publishes a message to RabbitMQ, and executes a full `prisma.file.update`. This will rapidly exhaust DB connection pools, broker memory, and server CPU, resulting in a system crash under minimal concurrent usage.
2. **Missing Database Indexes (`schema.prisma`)**
   - **Issue:** The database schema completely lacks indexes on frequently queried foreign keys, notably `Team.createdBy`, `File.teamId`, `File.createdBy`, `TeamMember.teamId`, and `TeamMember.userEmail`.
   - **Impact:** Heavy `findMany` queries for permissions and dashboard listing will trigger full table scans, resulting in an O(N) database degradation as the platform scales.
3. **Full-State Transmission instead of CRDT Deltas**
   - **Issue:** The WebSocket/HTTP sync mechanism transmits the entire stringified CRDT state on every update rather than using optimized CRDT deltas (e.g., Yjs update vectors).
   - **Impact:** Transmitting multimegabyte JSON strings on every keystroke causes extreme bandwidth bloat and latency spikes.

### High
1. **Cache Invalidation Bypass in WebSocket Server**
   - **Issue:** The standalone WebSocket gateway (`ws-server/server.ts`) writes directly to the database via Prisma and RabbitMQ (`queueDbWrite`), but fails to call `invalidateCachedFile(fileId)` to clear the Redis cache.
   - **Impact:** The HTTP fallback polling mechanisms and server-side components will serve stale file data from Redis, causing confusing CRDT merge conflicts and desynchronization for non-WebSocket clients.
2. **Uncompressed WebSocket Payloads**
   - **Issue:** The `ws` server instantiation (`new WebSocketServer({ noServer: true })`) does not enable `perMessageDeflate`.
   - **Impact:** Large collaborative canvases and documents are transmitted uncompressed over the network, compounding the bandwidth bloat caused by full-state transmission.

### Medium
1. **Client-Side History Memory Leak Risk**
   - **Issue:** The `Editor.tsx` maintains a manual history stack of up to 50 complete JSON strings of the document state (`historyRef.current`).
   - **Impact:** For a large document, retaining 50 uncompressed snapshots in React memory will lead to heavy RAM usage and potential browser tab crashes (OOM). History should ideally rely on the CRDT's internal history manager.
2. **Suboptimal Adaptive Polling Configuration**
   - **Issue:** The HTTP fallback polling sets an aggressive 4s polling interval, but the inactivity timeout is configured to `60000ms` (60s) instead of the requirement-specified 15s.
   - **Impact:** Idle background tabs will continue polling every 4 seconds for a full minute, generating unnecessary HTTP load.

### Low
1. **Inefficient Cursor Garbage Collection**
   - **Issue:** The `useCursors` hook runs a `setInterval` every 2000ms that loops over all active cursors to check for inactivity. 
   - **Impact:** Minor but unnecessary main-thread overhead; GC logic should ideally be event-driven or scheduled less frequently.

## Recommendations
1. **Implement Debouncing and Deltas:** Immediately introduce debouncing (e.g., 500ms - 1000ms) for saving canvas and document state to the server. Migrate from full-state transmission to a delta-based CRDT approach (like Yjs `encodeStateAsUpdate`).
2. **Apply Database Indexes:** Add `@@index` directives to all frequently queried foreign keys in `schema.prisma`.
3. **Fix Cache Coherency:** Ensure the RabbitMQ worker or the `ws-server` triggers Redis cache invalidation whenever a durable database write is completed.
4. **Enable WebSocket Compression:** Enable `perMessageDeflate: true` on the WebSocket server to compress the heavy JSON payloads.
5. **Optimize History Stack:** Refactor the Editor's history manager to use lightweight patches instead of full string snapshots.
6. **Adjust Backoff Timeout:** Correct the `inactivityTimeout` in `useAdaptiveInterval` from `60000` to `15000` to meet SLOs and save resources.
