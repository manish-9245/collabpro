# 🚀 CollabPro

[![Next.js Build](https://img.shields.io/badge/Next.js-14.1.0-blue?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Database](https://img.shields.io/badge/PostgreSQL-Prisma-green?logo=postgresql&logoColor=white)](https://postgresql.org/)
[![Auth](https://img.shields.io/badge/Auth-Native%20Session-purple?logo=security&logoColor=white)](https://github.com/manish-9245/collabpro)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

CollabPro is a premium, open-source collaborative whiteboard and system design workspace. It combines a real-time Markdown document editor side-by-side with an infinite collaborative engineering canvas equipped with standard flowchart shapes and 800+ standard AWS service and resource SVG icons. Group files into nested directories, invite team members, accept org memberships with secure notification invites, restore states via version checkpoints, and map your system architecture with flawless drag-and-drop mechanics.

CollabPro is engineered to be **completely self-contained with 100% zero external SaaS dependencies**. There is no need for third-party Convex DB, Clerk, or Kinde API keys. It runs entirely on your own database using a custom native state-sync gateway and session authentication engine, making it secure, ultra-fast, and ready for instant deployment.

---

## 🎨 Core Features

### 📝 1. Rich Collaborative Document Editor
- **Editor.js Blocks**: Responsive block-based document editing featuring custom paragraphs, checklists, headers, and bullet lists.
- **Bi-directional Split Screen**: Work simultaneously with a live documents panel on the left and a system design canvas on the right.
- **Syncing & Cache**: State auto-saves dynamically with custom save intervals and state caching to prevent network collisions.

### 📐 2. Infinite Collaborative Canvas
- **Excalidraw Engine Integration**: High-performance canvas supporting standard vector nodes, freehand sketching, custom colors, grouping, alignment, and export.
- **Unified Design Assets Sidebar**: A beautifully aligned, fully integrated right-side sidebar organizing drawing shapes across tabbed categories: Standard, AWS, Custom, and Library.
- **Dynamic Vector Icon Previews**: On-the-fly vector coordinate parsing using a custom preview renderer that calculates real-time bounding boxes and scales complex `.excalidrawlib` shapes into elegant inline SVG icons inside a premium 2-column grid.
- **800+ Searchable AWS Icons**: Search, filter, and drag-and-drop over 800 high-resolution AWS architecture or resource SVG nodes directly from the sidebar onto the canvas.
- **Drag-and-Drop Coordinate Mapping**: Drop AWS elements or standard flow nodes exactly where your cursor releases relative to viewport zoom and panning scroll states.
- **Atomic Rendering**: Immediate, lag-free file-data loading so you never see blank or broken shapes.
- **Collapsible Design Sidebar**: One-click collapsible panel header that hides the right-side library seamlessly to maximize focus and canvas real estate.
- **Full-Text Vector Search**: Immediate full-text search across all drawings, text nodes, and diagrams in the workspace via a beautifully animated overlay search dashboard panel.
- **Snappy Background Canvas Image Uploads**: Background uploader that converts raw canvas base64 images to multipart File payloads on the fly, replacing them in-memory with short relative URLs, eliminating database bloat completely!

### 📁 3. File & Nested Folder Tree Navigation
- **Directory Hierarchy**: Create and map files into parent folders or deeply nested subfolders.
- **Actions Menu**: Rename folders across all matching documents dynamically, and rename, archive, move, or permanently delete files inside a polished context menu.

### 👥 4. Multi-Tenant Team & Membership Security
- **Dual-Approval Notification Invites**: Add members to teams or organizations and allow them to accept/decline invites in a dedicated notification tab.
- **Settings Dashboard**: Switch seamlessly between active memberships and profile sections.
- **Premium Avatars**: Select animated, popular premium avatars to personalize your collaborator workspace profile.

### ⚡ 5. State-Sync & Performance Foundation
- **Smart Active-Backoff Polling**: Custom co-presence and query-synchronization backoff system that dynamically scales polling down from 4s to 15s during browser tab-blur or 1+ minute of user inactivity, slashing database connection overhead.
- **Zero-Latency Polling Resumption**: Guarantees instant synchronization and restores active 4s intervals the split-second a user interacts with the canvas or refocuses the browser.
- **Preloader Hides & Full-Size Image Layouts**: Beautiful, non-overlapping animated CSS spinner loaders inside document image tools with automatic full-size block expansions.

### 🤖 6. MCP Automation Tools
- **`collabpro_update_document`**: Agent-friendly document updates with optional optimistic conflict detection (`baseDocument`) and conflict resolution (`reject`, `merge`, `overwrite`).
- **`collabpro_update_whiteboard`**: Agent-driven Excalidraw element updates with merge-by-id behavior for concurrent human-agent edits.
- **Conflict-aware write flow**: Both tools use conditional updates and retries to avoid clobbering simultaneous edits.

---

## 🏗️ System Architecture & Synchronization Engine

CollabPro is engineered with a **dual-channel, stateful real-time synchronization framework** to guarantee zero-latency collaboration and complete offline resiliency. The platform operates on a **WebSocket-First** topology with an automatic **HTTP Adaptive Polling** fallback.

---

### 1. Architectural Topology Overview

```mermaid
graph TD
    %% Define Styles & Classes
    classDef client fill:#eff6ff,stroke:#2563eb,stroke-width:2px,color:#1e3a8a;
    classDef engine fill:#faf5ff,stroke:#7c3aed,stroke-width:2px,color:#4c1d95;
    classDef server fill:#fdf2f8,stroke:#db2777,stroke-width:2px,color:#831843;
    classDef ws fill:#fff1f2,stroke:#f43f5e,stroke-width:2px,color:#9f1239;
    classDef db fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#064e3b;
    classDef storage fill:#fffbeb,stroke:#d97706,stroke-width:2px,color:#78350f;

    subgraph ClientLayer ["CollabPro Client (Next.js & React)"]
        UI["CollabPro Responsive UI<br/>(Tailwind CSS + Lucide Icons)"]:::client
        EditorComponent["Block Document Editor<br/>(Editor.js Blocks)"]:::client
        CanvasComponent["System Design Canvas<br/>(Excalidraw Engine + AWS Icons)"]:::client
    end

    subgraph SyncLayer ["Hybrid State & Auth Clients"]
        SessionAuthClient["Session Auth Client<br/>(Cookie-based Hook Provider)"]:::engine
        StateSyncClient["State-Sync Client Proxy<br/>(WS Client + Fallback Polling)"]:::engine
    end

    subgraph GatewayLayer ["API & Communication Gateways"]
        AuthAPI["Next.js Auth Endpoints<br/>(/api/auth/me, login, register)"]:::server
        SyncAPI["Next.js HTTP Sync Gateway<br/>(/api/state-sync HTTP REST)"]:::server
        WSGateway["Standalone WS Gateway<br/>(ws-server: Port 3001)"]:::ws
    end

    subgraph DataLayer ["Stateful Databases & Storage"]
        PrismaORM["Prisma Client<br/>(Database Schema Engine)"]:::db
        PostgresDB["PostgreSQL / SQLite Database<br/>(Users, Teams, Files & Notifications)"]:::db
        AWS_Icons_List["jsDelivr CDN<br/>(800+ AWS SVG Assets)"]:::storage
    end

    %% Flow Connections
    UI -->|Check auth / authenticate| SessionAuthClient
    SessionAuthClient -->|Verify Session Cookie| AuthAPI
    
    UI -->|Render Rich Text| EditorComponent
    UI -->|Render Architecture| CanvasComponent
    
    EditorComponent <-->|Queries & Mutations| StateSyncClient
    CanvasComponent <-->|Debounced Auto-save Sync| StateSyncClient
    CanvasComponent -->|Fetch AWS SVG Base64| AWS_Icons_List

    %% Hybrid State Sync routing
    StateSyncClient <-->|"1. Try WebSockets (Real-time)"| WSGateway
    StateSyncClient <-->|"2. Fallback to HTTP Polling"| SyncAPI

    WSGateway -->|Cookie / Token Handshake Auth| AuthAPI
    WSGateway <-->|Direct SQL Mutations| PrismaORM
    SyncAPI <-->|Read / Write State| PrismaORM
    AuthAPI <-->|Query & Write Profiles| PrismaORM
    PrismaORM <-->|Database Connection Pool| PostgresDB

    %% Layout Links
    style ClientLayer fill:#f8fafc,stroke:#cbd5e1,stroke-dasharray: 5 5;
    style SyncLayer fill:#f8fafc,stroke:#cbd5e1,stroke-dasharray: 5 5;
    style GatewayLayer fill:#f8fafc,stroke:#cbd5e1,stroke-dasharray: 5 5;
    style DataLayer fill:#f8fafc,stroke:#cbd5e1,stroke-dasharray: 5 5;
```

---

### 2. Deep-Dive: Standing Standalone WebSocket Gateway (`ws-server/`)

The standalone WebSockets system (`server.ts`) is designed to run asynchronously on Port `3001`, handling low-overhead message routing independent of Next.js’s serverless or server-side routing loops:

* **Secure Upgrade & Token Handshake**:
  Upon connection upgrade (`upgrade` event), the gateway parses standard session identifiers from either the incoming `Cookie` header (`session_token`) or connection query parameters (`?token=...`). If authentication parsing fails or no matching session exists, the HTTP socket is aborted early (`401 Unauthorized`), protecting system resources against DDoS or spamming.
* **Granular Multi-Room Multiplexing**:
  Connected sockets are registered as `ClientConnection` models containing their parsed user profiles, active channel subscriptions (`subscriptions` map), and active workspace scopes (`joinedRooms` set). When a client joins or switches workspaces, a `join` action is emitted, isolating broad cursor/update packets to that specific `fileId` channel.
* **Direct Database Write Flow & Room Broadcasts**:
  To eliminate HTTP API layer overhead, standard mutations (`files:updateDocument`, `files:updateWhiteboard`) received over a socket are directly executed via the globally instanced `Prisma Client` pool. Once successfully written, the server triggers `broadcastQueryUpdateToRoom`, pulling the updated data from PostgreSQL/SQLite and broadcasting a synchronized payload back to all active subscribers in that workspace.
* **Liveness Heartbeats**:
  An internal heartbeat scheduler pings all active connections every 30s. Connections failing to respond to a `pong` before the next interval are automatically flagged and terminated, preventing memory bloat from dead TCP sockets.

---

### 3. Deep-Dive: Smart Adaptive-Backoff Polling

When WebSockets are blocked (due to firewalls, VPNs, or proxy rules), the `StateSyncClient` automatically falls back to an intelligent HTTP-polling controller:

```
[Active Tab / Interaction] ────────► 4s Polling Frequency
      │
      ├─► Tab Blurs / Hidden ─────────► 15s Polling Frequency (Saves Network)
      │
      └─► User Inactive > 60s ────────► 15s Polling Frequency (Saves DB Pool)
            │
            └─► Real-Time Input ──────► Resumes Instantly to 4s (Zero-Latency)
```

* **Dynamic Backoff Polling Triggers**:
  * **Default State (Active)**: Polling runs at a tight **4-second interval** to mirror near-real-time synchronization during active writing or drawing.
  * **Tab Blur (Visibility State)**: If a user minimizes the window or navigates to a different browser tab, the controller instantly triggers a backoff to **15 seconds** to prevent unnecessary network and server-load.
  * **Inactivity Timer**: If a tab remains visible but receives zero user interactions (mouse moves, scrolling, keyboard triggers, touch events) for more than **60 seconds**, polling shifts down to **15 seconds**.
* **Zero-Latency Polling Resumption**:
  The absolute split-second any local event (e.g., cursor hover, clicking, scrolling, or editing) is captured, the controller kills the active 15s timer and instantly forces a sync fetch, restoring the 4-second frequency loop.

---

### 4. Cache & Subscription Topology

To avoid redundant server hits and network race conditions, the client relies on a global, shared state cache (`queryCache`):

* **Shared Cached Map**:
  When queries are resolved (either via WebSocket broadcast or HTTP fallback), they are keyed by their absolute reference and stringified arguments inside a global `Map`. If multiple components subscribe to the same data block, they pull from the single source-of-truth cache.
* **Dual-Mode Sync Controller**:
  When executing a state change (`useMutation` / `useQuery`), the client proxy first verifies WebSocket liveness. If connected, the transaction is run over a WebSocket and returned as a Promise wrapped in a local event listener (timed out after 10s if the server fails to respond). If disconnected, the transaction seamlessly routes as a standard POST payload to the server's `/api/state-sync` REST gateway.

---

---

## 🛠️ Technology Stack

- **Frontend**: Next.js 14 (App Router), React 18, Tailwind CSS, Lucide Icons
- **Real-Time Engine**: `ws` (Standalone Node.js WebSockets Gateway on Port `3001`)
- **Database & ORM**: Prisma Client with standard PostgreSQL & local SQLite support
- **Synchronization**: Dual-mode State-Sync Client Proxy with automatic active-backoff
- **Authorization**: Custom secure session-cookie authentication engine with multi-tenant workspace partitioning
- **Document Engine**: Editor.js (Blocks-based nested plugins)
- **Canvas Engine**: `@excalidraw/excalidraw` (Vector system design layout with dynamic icon sidebar)

---

## 🚀 Getting Started

### 📋 Prerequisites
Ensure you have the following installed on your developer machine:
- Node.js (version 20 or higher)
- PostgreSQL database instance (or default to local SQLite database)

### 📦 1. Clone & Install Dependencies
```bash
git clone https://github.com/manish-9245/collabpro.git
cd collabpro
npm install
```

### 🔑 2. Environment Setup
Create a `.env` or `.env.local` file in the root directory and supply your database credentials:

```env
# Database Credentials
DATABASE_URL="postgresql://<user>:<password>@<host>:<port>/collabpro?schema=public"

# Optional Websocket Server Port (Defaults to 3001)
WS_PORT=3001
```

> [!NOTE]
> CollabPro does not require any third-party auth provider (like Clerk or Kinde) or real Convex cloud databases. All functionalities are natively handled by PostgreSQL/SQLite, your Next.js server, and the standalone WebSocket server!

### 🗃️ 3. Initialize Database Schema
Push the schema structure directly to your database:
```bash
npx prisma db push
```

### 💻 4. Launch Local Dev Server
Start the Next.js development server:
```bash
npm run dev
```

### 🔌 5. Start WebSocket Gateway
In a separate terminal tab, spin up the standalone WebSocket server:
```bash
npm run ws:start
```
Open [http://localhost:3000](http://localhost:3000) to view your self-hosted CollabPro workspace in action.

---

## 🌐 Production Deployment

### Railway Deployment Rules
- Make sure the `DATABASE_URL` environment variable is defined in your deployment dashboard settings.
- Do NOT run database migration triggers during build time as it might block. Run `npx prisma db push` beforehand or let the start trigger handle it natively.
- Deploy both the Next.js application server and the standalone WebSocket server container using `npm run ws:start` or by binding the main start command:
```bash
npm run build
npm run start
```

---

## 💖 Acknowledgements & Credits

CollabPro is built on top of and made possible by several incredible open-source projects, and we owe them a special debt of gratitude:

- **[Excalidraw](https://github.com/excalidraw/excalidraw)**: A massive thanks to the Excalidraw team for their outstanding, world-class virtual whiteboard library. Their robust vector graphics canvas engine enables the seamless, high-fidelity collaborative system diagramming experience that forms the core of CollabPro.
- **[Editor.js](https://github.com/codex-team/editor.js)**: For providing the exceptional block-styled extensible editor engine which powers CollabPro's rich document editor experience.
- **AWS Simple Icons**: For the comprehensive library of architecture and service icons that make technical system design smooth and professional.

---

## 📄 License
Distributed under the MIT License. See [LICENSE](LICENSE) for details.
