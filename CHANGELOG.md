# Releases & User Impacts

All official releases and user impacts are documented here in chronological order.

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

## [2.5.0] - 2026-06-15
### User Impact: New Capabilities
- **AWS Cloud Architecture Library**: Integrated 800+ standardized AWS cloud-design icons directly inside the whiteboard Canvas sidebar, enabling immediate, drag-and-drop system-design modeling.
- **Collapsible Layout Controls**: Replaced rigid canvas elements with collapsible sidebar panels and dynamic chevrons, expanding active workspace drawing space.

### User Impact: Performance & UX
- **Refined Block Typography**: Heightened padding and margins around Editor.js block actions, preventing text overlapping during collaborative diagramming.
- **Enhanced Canvas Stability**: Mitigated Node-selection memory leaks in Excalidraw, safeguarding page responsiveness during complex architectural diagrams.

---

## [2.0.0] - 2026-05-18
### User Impact: New Capabilities
- **Smart Folder Trees**: Rolled out nested file directories inside the active dashboard sidebar, permitting users to drag, drop, and group documents with infinite depth.
- **Workspace Lifecycle Actions**: Enabled direct rename, duplicate, delete, and archive controls for files without navigating away from the workspace views.
- **Multi-Tenant Scopes**: Created clean, light-mode modal dialogs to easily manage team roles, switch organizations, and invite collaborators.

### User Impact: Performance & UX
- **Flicker-Free SSR Rendering**: Re-engineered core whiteboard canvas and document editor packages using dynamic Next.js components (`ssr: false`), preventing client-side page load crashes.

---

## [1.0.0] - 2026-04-10
### User Impact: New Capabilities
- **Collaborative Split-Screen Canvas**: Built the core co-authoring workspace, integrating a rich Markdown editor synchronously with an infinite vector whiteboard canvas.
- **Automated Version History**: Enabled real-time auto-saving with a dedicated Version History drawer. Engineers can create custom-named checkpoints and restore previous versions in one click.
- **Rich Vector Exports**: Allowed instant canvas design exports directly to SVG, PNG, or clipboard formats.
