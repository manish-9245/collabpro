# 🚀 CollabPro

[![Next.js Build](https://img.shields.io/badge/Next.js-14.1.0-blue?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Convex DB](https://img.shields.io/badge/Convex-Reactive%20Sync-yellow?logo=conflux&logoColor=white)](https://convex.dev/)
[![Prisma Database](https://img.shields.io/badge/Prisma-ORM-green?logo=prisma&logoColor=white)](https://prisma.io/)
[![Kinde Auth](https://img.shields.io/badge/Kinde-Auth-purple?logo=auth0&logoColor=white)](https://kinde.com/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

CollabPro is a premium, open-source collaborative workspace and system design platform. It combines a real-time markdown document editor alongside an infinite collaborative engineering canvas equipped with standard flowchart elements and 800+ standard AWS service and resource SVG icons. Group files into nested directories, invite team members, accept org memberships with secure notification invites, restore state via version checkpoints, and map your system architecture with flawless drag-and-drop mechanics.

---

## 🎨 Core Features

### 📝 1. Rich Collaborative Document Editor
- **Lexical Engine**: Responsive real-time rich-text markdown writing.
- **Bi-directional Split Screen**: Work simultaneously with a live documents panel on the left and a system design canvas on the right.
- **Syncing & Debounce**: State auto-saves dynamically with custom save intervals to prevent network collision.

### 📐 2. Infinite Collaborative Canvas
- **Excalidraw Engine Integration**: Standard vector nodes, freehand sketching, colors, grouping, alignment, and export.
- **800+ AWS Icons System**: Drag or click to inject high-resolution AWS architecture or resource SVG nodes directly from a searchable, paginated sidebar.
- **Drag-and-Drop Coordinate Mapping**: Drop AWS elements or standard flow nodes exactly where your cursor releases relative to viewport zoom and panning scroll states.
- **Atomic Rendering**: Immediate, lag-free file-data loading so you never see blank or broken shapes.
- **Collapsible Elements Panel**: One-click collapsible sidebar header allowing full canvas usage.

### 📁 3. File & Nested Folder Tree Navigation
- **Directory Hierarchy**: Create and map files into parent folders or deeply nested subfolders.
- **Actions Menu**: Rename folders across all matching documents dynamically, and rename, archive, move, or permanently delete files inside a polished context menu.

### 👥 4. Multi-Tenant Team & Membership Security
- **Dual-Approval Notification Invites**: Add members to teams or organizations and allow them to accept/decline invites in a dedicated notification tab.
- **Settings Dashboard**: Switch seamlessly between active memberships and profile sections.
- **Premium Avatars**: Select animated, popular premium avatars to personalize your collaborator workspace profile.

---

## 🏗️ System Architecture

The following Mermaid diagram outlines the high-level request lifecycle, state replication, and data stores behind CollabPro:

```mermaid
graph TD
    %% Define Styles & Classes
    classDef client fill:#eff6ff,stroke:#2563eb,stroke-width:2px,color:#1e3a8a;
    classDef api fill:#faf5ff,stroke:#7c3aed,stroke-width:2px,color:#4c1d95;
    classDef auth fill:#fdf2f8,stroke:#db2777,stroke-width:2px,color:#831843;
    classDef db fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#064e3b;
    classDef storage fill:#fffbeb,stroke:#d97706,stroke-width:2px,color:#78350f;

    subgraph ClientLayer ["CollabPro Client (Next.js & React)"]
        UI["CollabPro Responsive UI<br/>(Tailwind CSS + Lucide Icons)"]:::client
        EditorComponent["Real-time Markdown Editor<br/>(Lexical Editor)"]:::client
        CanvasComponent["System Design Canvas<br/>(Excalidraw Engine + AWS Icons)"]:::client
    end

    subgraph AuthLayer ["Identity & Access Control"]
        Kinde["Kinde Auth Platform<br/>(Multi-tenant JWT Auth)"]:::auth
    end

    subgraph ServerLayer ["Serverless Middleware & Sync Engine"]
        ConvexAPI["Convex Dev Server<br/>(Reactive State WebSocket Sync)"]:::api
        NextAPI["Next.js Server Actions<br/>(API Routes & Dynamic SSE)"]:::api
    end

    subgraph DataLayer ["Stateful Databases & Storage"]
        PrismaORM["Prisma Client<br/>(Database Schema Engine)"]:::db
        NeonDB["PostgreSQL Database<br/>(User, Team & Org Memberships)"]:::db
        AWS_Icons_List["jsDelivr CDN<br/>(800+ AWS SVG Assets)"]:::storage
    end

    %% Flow Connections
    UI -->|JWT Token Auth| Kinde
    UI -->|Render Rich Text| EditorComponent
    UI -->|Render Architecture| CanvasComponent
    
    EditorComponent <-->|WebSocket Real-time Polling| ConvexAPI
    CanvasComponent <-->|Debounced Auto-save Sync| ConvexAPI
    CanvasComponent -->|Fetch AWS SVG Base64| AWS_Icons_List

    ConvexAPI <-->|Sync State| NeonDB
    NextAPI <-->|Prisma Database Engine| NeonDB
    PrismaORM <-->|Client Queries| NeonDB

    %% Layout Links
    style ClientLayer fill:#f8fafc,stroke:#cbd5e1,stroke-dasharray: 5 5;
    style ServerLayer fill:#f8fafc,stroke:#cbd5e1,stroke-dasharray: 5 5;
    style DataLayer fill:#f8fafc,stroke:#cbd5e1,stroke-dasharray: 5 5;
```

---

## 🛠️ Technology Stack

- **Frontend**: Next.js 14 (App Router), React 18, Tailwind CSS, Lucide icons, Framer Motion
- **Database ORM**: Prisma Client (with PostgreSQL pool proxy)
- **Real-Time Replication**: Convex reactive state engine (WebSockets replication)
- **Authorization**: Kinde Auth API (secure session JWTs)
- **Canvas Engine**: `@excalidraw/excalidraw`

---

## 🚀 Getting Started

### 📋 Prerequisites
Ensure you have the following installed on your developer machine:
- Node.js (version 20 or higher)
- PostgreSQL database instance

### 📦 1. Clone & Install Dependencies
```bash
git clone https://github.com/manish-9245/collabpro.git
cd collabpro
npm install
```

### 🔑 2. Environment Setup
Create a `.env.local` or `.env` file in the root directory and supply your PostgreSQL connection string:

```env
# Database Credentials
DATABASE_URL="postgresql://<user>:<password>@<host>:<port>/collabpro?schema=public"
```

> [!NOTE]
> CollabPro features a built-in local emulation layer for Kinde Authentication and Convex state sync. No third-party accounts or secrets are required for these systems.

### 🗃️ 3. Initialize Prisma Database Schema
Push the schema structure to your PostgreSQL database:
```bash
npx prisma db push
```

### 💻 4. Launch Local Dev Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the application in action.

---

## 🌐 Production Deployment

### Vercel / Railway Deployment Rules
- Make sure the `DATABASE_URL` environment variable is defined in your deployment dashboard settings.
- Do NOT run database migration triggers during build time as it might block. Run `npx prisma db push` beforehand or via custom runtime deployment hooks.
- Deploy the production Next.js bundle:
```bash
npm run build
```

---

## 📄 License
Distributed under the MIT License. See [LICENSE](LICENSE) for details.
