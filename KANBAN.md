# 📋 CollabPro — Development Kanban Board

This Kanban board tracks active feature development, architectural enhancements, and future milestones for the **CollabPro** ecosystem, including candidates integrated from the Excalidraw Plus roadmap.

---

## 🗺️ Visual Board Overview

| 📋 Backlog | ⏳ In Progress | ✅ Shipped / Done |
| :--- | :--- | :--- |
| **Integrations & APIs**<br>• `BACKLOG-1` GitHub PR Diagram Actions<br>• `BACKLOG-2` Public API & Custom Keys<br>• `BACKLOG-3` SSO & Auth Handlers | **State & Sync**<br>• `INPROG-1` Yjs CRDT Canvas Integration<br>• `INPROG-2` Smart Presence stack UI<br>• `INPROG-3` Smart Backoff Polling | **Canvas Enhancements**<br>• `SHIPPED-1` Unified Asset Sidebar (Tabs)<br>• `SHIPPED-2` On-the-fly SVG Library Previews<br>• `SHIPPED-3` Searchable 800+ AWS Icons |
| **Productivity & Search**<br>• `BACKLOG-4` Fulltext Drawing Search<br>• `BACKLOG-5` Global Command Palette (`Cmd+K`)<br>• `BACKLOG-6` PDF Canvas Imports | **Ecosystem & Host**<br>• `INPROG-4` pgBouncer Pool Setup<br>• `INPROG-5` Version History side-drawer<br>• `INPROG-6` Custom Workspace Fonts | **Performance & Bugfixes**<br>• `SHIPPED-4` Block Mover Spacing Fix<br>• `SHIPPED-5` Next.js Metadata Image Fix<br>• `SHIPPED-6` 100% Zero-SaaS Local Setup |

---

## 🔍 Task Details & Progress Cards

### 📋 1. Backlog Cards (Future Release Planning)

#### `BACKLOG-1` GitHub PR Diagram Embed Actions
* **Description:** Build a custom GitHub Action that parses vector `.excalidraw` scenes inside codebase commits and automatically updates diagram preview embeds in PR descriptions and Markdown files.
* **Milestone:** Milestone 4
* **Priority:** Medium
* **Status:** [ ] Open

#### `BACKLOG-2` Full-Text Drawing Search Indexer
* **Description:** Extract text elements from canvas Excalidraw JSON schemas on save and index them in a searchable PostgreSQL text column, allowing global workspace keyword search across drawings.
* **Milestone:** Milestone 2
* **Priority:** High
* **Status:** [ ] Open

#### `BACKLOG-3` Global Application Command Palette (`Cmd+K`)
* **Description:** Implement a premium global search and command launcher overlay (`Cmd+K` / `Ctrl+K`) to let users jump between files, transition memberships, or trigger workspace UI options from anywhere.
* **Milestone:** Milestone 3
* **Priority:** Medium
* **Status:** [ ] Open

#### `BACKLOG-4` PDF Canvas Import & Annotation Markup
* **Description:** Enable users to drag-and-drop a PDF file directly onto the whiteboard canvas as a background asset to perform highlight, mockup, and system overlay sketches on top.
* **Milestone:** Milestone 3
* **Priority:** Medium
* **Status:** [ ] Open

#### `BACKLOG-5` Real-time Shared Asset Library Sync
* **Description:** Allow organization members to publish custom vector shapes and `.excalidrawlib` coordinate packs to a shared team catalog, making drawing elements available instantly to other team members.
* **Milestone:** Milestone 2
* **Priority:** High
* **Status:** [ ] Open

---

### ⏳ 2. In Progress Cards (Active Development Cycle)

#### `INPROG-1` Yjs CRDT Integration & Conflict Resolution
* **Description:** Port the document (Editor.js) and canvas (Excalidraw) data-layer triggers to use conflict-free replicated data types, completely eliminating state collisions.
* **Milestone:** Milestone 2
* **Priority:** High
* **Status:** [ ] In Development

#### `INPROG-2` Smart Adaptive Polling Engine
* **Description:** Build a smart active-backoff system that slows down browser client polling (from `4s` to `15s` or `30s`) when the document tab is unfocused or the user is inactive.
* **Milestone:** Milestone 1
* **Priority:** High
* **Status:** [/] Testing Backoff Triggers

#### `INPROG-3` Live Presence Stack (UI Display)
* **Description:** Implement a floating avatar stack (`(JD) (ST) (AW) +2`) in the active workspace header showing current active collaborators, with real-time border halo highlights.
* **Milestone:** Milestone 1
* **Priority:** Medium
* **Status:** [/] Designing Header Stack

---

### ✅ 3. Shipped / Done Cards (Completed Features)

#### `SHIPPED-1` Unified Asset Sidebar Tab System
* **Description:** Redesigned the drawing tool layout to combine Standard flowchart elements, AWS Architecture icons, Custom shapes, and local Libraries inside a clean, cohesive, right-aligned tabbed sidebar panel.
* **Status:** [x] Merged to Main
* **Completion Date:** 2026-07-06

#### `SHIPPED-2` On-The-Fly Vector SVG Library Previews
* **Description:** Created the premium React custom preview helper component `LibraryItemPreview` inside `Canvas.tsx`. It dynamically parses `.excalidrawlib` coordinate geometries, calculates bounding boxes, and draws scaled inline SVGs in a polished 2-column active library catalog.
* **Status:** [x] Merged to Main
* **Completion Date:** 2026-07-06

#### `SHIPPED-3` Searchable 800+ AWS Icons System
* **Description:** Programmed an immediate, high-fidelity client-side search indexing across 800+ AWS Simple Icons, complete with pagination and drag-and-drop coordinate scaling mapping.
* **Status:** [x] Merged to Main
* **Completion Date:** 2026-07-06

#### `SHIPPED-4` Editor Block Mover Proximity Tuning
* **Description:** Shifted the EditorJS block action buttons (block settings handle and plus block inserter) further to the left to avoid text collisions and improve typography readability.
* **Status:** [x] Merged to Main
* **Completion Date:** 2026-07-07
