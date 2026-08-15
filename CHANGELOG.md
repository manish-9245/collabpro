# Releases & User Impacts

All official releases and user impacts are documented here in chronological order.

---

## [4.0.0] - 2026-08-16
### User Impact: New Capabilities
- **MCP Automation Platform, Rebuilt on the Official SDK**: Migrated the AI-agent integration onto `@modelcontextprotocol/sdk` behind a real, spec-compliant Streamable HTTP server at `/api/mcp` (plus a stdio bridge for Claude Desktop/Cursor/Windsurf). Grew from a handful of ad-hoc tools to **8 schema-validated tools** — list, get, and create files; update a document or whiteboard; search, list, and place icons from 200+ community Excalidraw libraries — all access-scoped to the caller's teams and going through the same compare-and-swap writers as every other write path in the app.
- **`collabpro_update_whiteboard` Merges by Default**: Building a diagram across many tool calls (one call per node, as any AI agent naturally does) used to mean each call silently discarded the previous one's work, since a plain element array was always a full replace. It now merges onto the existing board by id by default — full-replace is an explicit `replaceAll` opt-in.
- **Ref-Based Icon Placement**: `collabpro_get_library_icon` now returns a short-lived placement `ref` instead of an icon's full multi-primitive element geometry — an agent placing a dozen icons in a diagram no longer has to read and re-emit hundreds of raw shape objects through its own context.
- **Server-Enforced Diagram Quality**: `collabpro_update_whiteboard` now rejects — not just discourages — overlapping shapes, non-finite coordinates, text with no visible color, and zero-length arrows, with the offending element named in the error. A `collabpro_diagram_guidelines` prompt covers the rest: semantic color palette, spacing, section-header placement, and real Excalidraw arrow-to-shape bindings.
- **Multi-Provider AI Co-Pilot**: The in-editor chat sidebar now supports OpenAI, Anthropic (native Messages API, not just OpenAI-compatible), Gemini, and NVIDIA NIM, with a real provider picker and dynamic model-list fetch per team, gated to the team's owner and encrypted at rest.
- **Public Live Whiteboard Embeds**: Any share link can now back an always-fresh, unauthenticated SVG embed (`/api/embed/[shareToken]`) — drop a diagram straight into a GitHub README and it reflects the canvas's current state on every fetch, no re-export needed.
- **Organization Admin & Compliance Center**: Domain-restricted signup, active-seat limits, and a queryable compliance audit log covering auth, API keys, team/org changes, and MCP writes.
- **Redesigned Settings, Developer Hub, Help Center, and Profile**: One shared settings shell (General/AI/MCP/Admin) instead of four unlinked URLs; a Developer Hub grounded in the real MCP tool registry with a live sandbox; a Help Center with real FAQs and guides instead of placeholder links; 60 self-hosted animated avatars with zero third-party hotlinking.
- **Command Palette, PDF Canvas Import**: Global `Cmd+K` command palette; import and annotate PDFs directly on the design canvas.
- **Kubernetes/Helm & Multi-Stage Docker**: A production Helm chart (EKS/GKE/AKS/minikube) and multi-stage Dockerfiles alongside the existing `docker-compose.yml` path.

### User Impact: Performance & UX
- **Event-Driven Real-Time Sync**: Whiteboard collaboration moved from polling-heavy state reconciliation to Redis Pub/Sub with a debounced database write-back, plus a RabbitMQ-backed durability record for the WebSocket gateway's direct writes (published only after the authoritative write succeeds, never before — closing a "phantom save" class of bug where a client could be told a save succeeded before it actually had).
- **Image Resize That Actually Persists**: Fixed a real editor bug where a resized image's width was silently dropped on every save, not just on quick navigation — pasted images now also keep their natural size by default, with left/center/right alignment, and the resize overlay tracks the image in real time during drag instead of lagging behind.
- **Redis Circuit Breaker**: Stops paying a fresh connection-timeout on every single request once Redis is already known to be down, instead of retry-storming a dead cache on every read.
- **Background Web Workers**: Heavy CRDT state compression/parsing moved off the main thread.
- **Team Switching Persists**: The active team now survives navigating away and back (e.g. opening a document), instead of silently resetting to whichever team the API happened to return first.
- **Custom, Accessible Dropdowns and Syntax-Highlighted Code**: Every native `<select>` in the app replaced with a responsive, themed dropdown; every code snippet (setup commands, MCP config, sandbox output) now renders with real syntax highlighting instead of flat text.

### User Impact: Security & Simplification
- **Session Hardening**: Signed JWT sessions now require an explicit `SESSION_SECRET` (the app refuses to boot without one), with token expiry and a constant-time signature comparison (closing a timing side-channel).
- **Closed a WebSocket Auth Bypass and an IP-Spoofable Rate Limiter**: The WS gateway's handshake and the rate limiter's client-IP extraction were both hardened against spoofed headers; hardcoded fallback secrets were removed entirely.
- **Fixed IDOR on Version History and Share Links**: Version fetches and share-link/password endpoints are now properly authorized per-request, not just per-session.
- **SVG Upload Hardening**: Uploaded SVGs are never rendered as live documents (removes a stored-XSS vector), and canvas image uploads are validated by magic bytes, not just file extension.
- **Redis-Backed Rate Limiting Across Replicas**: Auth-adjacent endpoints (login, register, share-link password checks) enforce limits correctly across every replica/process via an atomic Redis Lua script, with an in-memory fallback if Redis is unavailable.
- **Cascading-Delete Verification Suite**: A dedicated regression suite confirms that deleting a team/user/file actually cascades everywhere it should, and nowhere it shouldn't.

---

## [3.1.0] - 2026-07-09
### User Impact: New Capabilities
- **Vector Canvas drawings Search Indexer**: Deployed a state-of-the-art server-side text-extraction background hook and a beautiful real-time search dashboard overlay in the canvas panel, allowing immediate full-text search across all drawings and diagrams in the workspace!
- **Background Multi-Part Canvas Image Sync**: Added a background file uploader that intercepts raw canvas binary/base64 uploads, stores them securely in public storage, and updates Excalidraw references with relative URLs.

### User Impact: Performance & UX
- **Smart Active-Backoff Polling**: Integrated a custom co-presence and query-synchronization backoff system that dynamically scales polling down from 4s to 15s during browser tab-blur or 1+ minute of user inactivity, slashing database connection overhead.
- **Zero-Latency Polling Resumption**: Guarantees instant synchronization and restores active 4s intervals the split-second a user interacts with the canvas or refocuses the browser.
- **Document Image Loading Transitions**: Solved overlapping unstyled loader blocks with smooth, animated CSS spinners and configured automatic full-size block-level expansions for maximum visual clarity.

### User Impact: Security & Simplification
- **Base64 String Database Protection**: Defers active database writes while image uploads are in progress, ensuring not a single byte of massive raw base64 data ever touches or bloats the relational database.

---

## [3.0.0] - 2026-07-07
### User Impact: New Capabilities
- **Dedicated Release Center**: Implemented a standalone, ultra-premium Release Hub route `/releases` allowing prospective users and enterprise stakeholders to track the development roadmap.
- **Sovereign Local Authentication**: Replaced third-party data tracking and Kinde auth with fully localized, secure session cookie authentication. 100% private data sovereignty.
- **Multi-Channel SEO Enhancements**: Upgraded Next.js page layouts with detailed robots tags, OpenGraph previews, and keywords for high-speed crawler indexing and professional social sharing.

### User Impact: Performance & UX
- **Streamlined Landing Navigation**: Purged legacy links and cluttered tab selectors to direct users cleanly to core feature specifications and onboarding funnels.
- **Pruned Unused System Scripts**: Cleaned up residual setup and diagnostic scripts, creating a lightweight, production-ready codebase suitable for public distribution.
- **Optimized Loading Latency**: Migrated release parsing server-side via fast Node.js Markdown mapping, yielding a 95+ Lighthouse score.

### User Impact: Security & Simplification
- **Database Exposure Protection**: Configured strict local SQLite exclusions inside `.gitignore` to prevent any development databases or sensitive local environments from being exposed.

---

## [2.5.0] - 2026-07-06
### User Impact: New Capabilities
- **AWS Cloud Architecture Library**: Integrated 800+ standardized AWS cloud-design icons directly inside the whiteboard Canvas sidebar, enabling immediate, drag-and-drop system-design modeling.
- **Collapsible Layout Controls**: Replaced rigid canvas elements with collapsible sidebar panels and dynamic chevrons, expanding active workspace drawing space.

### User Impact: Performance & UX
- **Refined Block Typography**: Heightened padding and margins around Editor.js block actions, preventing text overlapping during collaborative diagramming.
- **Enhanced Canvas Stability**: Mitigated Node-selection memory leaks in Excalidraw, safeguarding page responsiveness during complex architectural diagrams.

---

## [2.0.0] - 2026-07-05
### User Impact: New Capabilities
- **Smart Folder Trees**: Rolled out nested file directories inside the active dashboard sidebar, permitting users to drag, drop, and group documents with infinite depth.
- **Workspace Lifecycle Actions**: Enabled direct rename, duplicate, delete, and archive controls for files without navigating away from the workspace views.
- **Multi-Tenant Scopes**: Created clean, light-mode modal dialogs to easily manage team roles, switch organizations, and invite collaborators.

### User Impact: Performance & UX
- **Flicker-Free SSR Rendering**: Re-engineered core whiteboard canvas and document editor packages using dynamic Next.js components (`ssr: false`), preventing client-side page load crashes.

---

## [1.0.0] - 2026-07-05
### User Impact: New Capabilities
- **Collaborative Split-Screen Canvas**: Built the core co-authoring workspace, integrating a rich Markdown editor synchronously with an infinite vector whiteboard canvas.
- **Automated Version History**: Enabled real-time auto-saving with a dedicated Version History drawer. Engineers can create custom-named checkpoints and restore previous versions in one click.
- **Rich Vector Exports**: Allowed instant canvas design exports directly to SVG, PNG, or clipboard formats.
