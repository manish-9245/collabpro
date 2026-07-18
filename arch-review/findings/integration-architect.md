# Integration Architecture Review: CollabPro

**Date:** 2026-07-18
**Reviewer:** Integration Architect

## Executive Summary
CollabPro implements a robust, dual-channel state synchronization engine, utilizing a standalone Node.js WebSocket gateway backed by Redis Pub/Sub for horizontal scaling and RabbitMQ for database write queues, alongside a resilient HTTP adaptive polling fallback. While the integration architecture fulfills the "Zero SaaS Dependency" requirement and remains completely database-agnostic using standard Prisma string fields, several discrepancies between the documented Service Level Objectives (SLOs) and the actual implementation were discovered. In particular, the Adaptive Polling implementation deviates from the stated documentation, and there are critical risks of "thundering herds" due to the lack of jitter in the WebSocket reconnection logic. 

## Key Findings

### Critical
1. **Adaptive Polling Implementation vs. Documentation Mismatch**: 
   The system documentation (README.md, Intake) claims the HTTP fallback polling dynamically scales down to a `15s` frequency during tab blur or user inactivity. However, an inspection of `lib/state-sync/react.tsx` (`useAdaptiveInterval`) reveals the actual polling backoff defaults to `60000ms` (60 seconds) for inactivity and severely drops to `300000ms` (5 minutes) when the document visibility state is `"hidden"`. This undocumented 5-minute timeout will cause significant latency spikes for users returning to blurred tabs, violating the stated SLO.

### High
1. **WebSocket "Thundering Herd" Vulnerability**: 
   In `StateSyncWSClient` (`lib/state-sync/react.tsx`), the reconnection logic (`scheduleReconnect`) implements standard exponential backoff (`Math.min(delay * 2, maxReconnectDelay)`). However, no randomized jitter is applied to the calculated delay. During a transient network partition or server restart, all clients will attempt to reconnect simultaneously at exact intervals, potentially causing an immediate DDoS-like surge that overwhelms the WebSocket gateway and Postgres connection pool.

### Medium
1. **RabbitMQ Degradation Fallback Overloads Database**: 
   The `queueDbWrite` helper in `ws-server/server.ts` handles RabbitMQ queue persistence. If the broker is unreachable (`!mqChannel` or publish error), it falls back to a synchronous `executeSave()` directly against the database. If RabbitMQ goes down during peak traffic, the entire surge of writes will hit the database synchronously over WebSocket connections, defeating the purpose of the durable queue and risking a Postgres connection exhaustion cascade.
2. **Silent Drops in Redis Pub/Sub Cluster Scaling**: 
   The WebSocket horizontal scaling uses Redis `pubClient.publish()` with a chained empty catch block: `.catch(() => {})`. If the Redis node experiences latency or disconnects, messages are silently dropped across the cluster without any fallback delivery or application warning.

### Low
1. **Hardcoded Environment Routing in WS Client**: 
   The `getWsUrl()` function inside `lib/state-sync/react.tsx` contains hardcoded references to `localhost:3001` and specific production hostnames (e.g., `collabpro.buildwithmanish.com`). This tight coupling to specific domains makes white-label deployments cumbersome and should rely purely on checking standard environment variables like `NEXT_PUBLIC_WS_URL`.
2. **WebSocket Message Parsing Silent Failures**: 
   Incoming messages on the WebSocket gateway (`ws-server/server.ts`) wrap `JSON.parse` in a try-catch block that sends back a generic `"Invalid payload format"` without logging the specific payload issue or alerting the monitoring stack.

## Recommendations
1. **Align Adaptive Polling**: Modify the `useAdaptiveInterval` function defaults in `lib/state-sync/react.tsx` to match the 15-second specification (`300000` to `15000` and `60000` to `15000`), or update the global documentation to reflect the 60s / 5m reality.
2. **Introduce Reconnection Jitter**: Update the WS reconnection timeout to include random jitter. For example: `const jitter = Math.floor(Math.random() * 1000); const finalDelay = delay + jitter;`
3. **Decouple Routing Logic**: Remove hardcoded domain evaluations in the client proxy and strictly use standard `process.env` variable overrides for WebSocket URL definitions.
4. **Harden Message Queue Reliability**: If RabbitMQ fails, implement a bounded semaphore or rate limiter for the direct DB fallback so the database doesn't instantly crash under an unbounded write storm.
