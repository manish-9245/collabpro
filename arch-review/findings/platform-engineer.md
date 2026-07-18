# Architecture Review: Platform & Infrastructure

**Target:** `/Users/manishtiwari/Documents/erasor_clone`
**Reviewer:** Platform Engineer
**Date:** 2026-07-18

## 1. Summary
The platform architecture relies on Next.js 14, a standalone Node.js WebSocket server, Docker, Kubernetes (via Helm), and GitHub Actions. While the foundation correctly implements multi-stage Docker builds, non-root security contexts, and container resource limits, the system suffers from several critical operational and security flaws. Most severely, the application initiates irreversible data loss procedures during production container startup, and relies on development-grade tools and configurations in its production infrastructure.

## 2. Key Findings

### Critical
1. **Destructive Database Operations on Startup (Data Loss Risk):**
   The `web` container uses the `"start"` script from `package.json`: `"prisma db push --accept-data-loss && next start"`. Running `db push` with the `--accept-data-loss` flag upon every container initialization in production guarantees silent, catastrophic data deletion if the database schema detects drifts. Production deployments must use `prisma migrate deploy` exclusively.
2. **Hardcoded Plaintext Secrets in Infrastructure:**
   Both `docker-compose.yml` and the Kubernetes Helm values (`charts/collabpro/values.yaml`) contain hardcoded, plaintext secrets. Examples include `SMTP_PASSWORD: "hzqq uzmb ldnl idjl"` and `postgres.password: "collabpro_secure_password"`. Secrets must be completely decoupled from source control and injected via Kubernetes Secrets, External Secrets Operator, or AWS/GCP Secret Managers.

### High
1. **Missing Kubernetes Liveness & Readiness Probes:**
   Neither `web-deployment.yaml` nor `ws-deployment.yaml` define `livenessProbe` or `readinessProbe`. Kubernetes cannot determine if the application is ready to receive traffic or if a process is deadlocked, crippling self-healing capabilities and zero-downtime rolling deployments.
2. **Executing TypeScript in Production via TSX:**
   The `ws-server/Dockerfile` delegates its startup command to `"ws:start"`, which executes `tsx ws-server/server.ts`. `tsx` is an on-the-fly TypeScript execution engine intended strictly for development. It introduces severe memory bloat and slow cold-starts. The WebSocket server must be transpiled to JavaScript (`tsc` or `esbuild`) during the Docker build stage and executed via native `node`.
3. **Massive Container Image Bloat:**
   The Dockerfiles execute `npm ci` without the `--omit=dev` flag in the builder stage and copy the entire `node_modules` directory into the production runner. Combined with the absence of Next.js's `output: 'standalone'` configuration in `next.config.mjs`, the production image carries hundreds of megabytes of unnecessary development dependencies (e.g., Playwright, Vitest).

### Medium
1. **Missing Continuous Deployment (CD) Pipeline:**
   The GitHub Actions workflow (`.github/workflows/ci.yml`) compiles the Next.js app and runs tests but completely lacks a CD phase. It does not build the Docker images, push them to a container registry, or trigger a Helm deployment, leading to a disconnected CI/CD lifecycle.
2. **Missing Component in Kubernetes Manifests:**
   A `rabbitmq` container is defined in `docker-compose.yml` for reliable queueing. However, it is entirely omitted from the Helm chart (`charts/collabpro/`). If the application relies on RabbitMQ (as `amqplib` and `bullmq` in `package.json` imply), the Helm deployment is functionally incomplete.
3. **Static Replica Counts & Missing HPA:**
   The Helm chart relies on static replicas (`replicaCount.web: 2`) without implementing a Horizontal Pod Autoscaler (HPA). The infrastructure cannot automatically scale under load based on CPU/Memory metrics.

### Low
1. **Mutable Root Filesystem:**
   The Helm chart specifies `readOnlyRootFilesystem: false`. For better security hardening, the root filesystem should be read-only (`true`), with temporary writes (like the Next.js cache) mapped to `emptyDir` volumes in memory.
2. **Missing Kubernetes Network Policies:**
   There are no network policies restricting ingress/egress communication between the Next.js web application, the WebSocket gateway, and the databases.

## 3. Recommendations
1. **Fix Startup Scripts:** Change `"start"` in `package.json` to `"next start"`. Handle database migrations using a dedicated init-container or pre-deployment Job running `npx prisma migrate deploy`. Remove `db push --accept-data-loss` completely from non-development contexts.
2. **Secure Secrets:** Remove all plaintext passwords from `values.yaml` and `docker-compose.yml`. Use `.env` files for local Docker compose (added to `.gitignore`), and rely on native Kubernetes Secrets referencing in Helm (`envFrom: - secretRef`).
3. **Add Probes:** Implement `/api/health` endpoints on both `web` and `ws` services, and configure `livenessProbe` and `readinessProbe` blocks in the deployment manifests.
4. **Compile TypeScript:** Add a `"build:ws": "tsc -p ws-server/tsconfig.json"` step. Update the `ws-server/Dockerfile` to run `node ws-server/dist/server.js`.
5. **Optimize Images:** Configure `output: 'standalone'` in `next.config.mjs`. Copy only the `.next/standalone` directory and `public` into the `web` production runner, entirely avoiding copying the raw `node_modules`.
6. **Implement CD Pipeline:** Extend `ci.yml` to build and push Docker images using `@docker/build-push-action`, and deploy to the cluster using Helm on successful merges to `main`.
