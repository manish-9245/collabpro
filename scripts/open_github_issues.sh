#!/bin/bash
# ==============================================================================
# CollabPro — GitHub Feature Request Creator Script
# This script uses the GitHub CLI (gh) to generate professional feature requests
# on your repository based on our Excalidraw Plus roadmap alignment.
# ==============================================================================

# Ensure gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ Error: GitHub CLI 'gh' is not installed."
    echo "Please install it using: brew install gh"
    exit 1
fi

# Fetch repository details
REPO_URL=$(git remote get-url origin 2>/dev/null)
if [ -z "$REPO_URL" ]; then
    echo "❌ Error: Not a git repository or no remote origin found."
    exit 1
fi

echo "=================================================================="
echo "🛡️  CollabPro GitHub Feature Request Creator"
echo "=================================================================="
echo "Found Remote Repository: $REPO_URL"
echo "This script will create 6 advanced feature request issues on your repository."
echo "Please make sure you are authenticated in this shell."
echo "------------------------------------------------------------------"

create_issue() {
    local title="$1"
    local body="$2"
    local label="$3"
    
    echo "Creating issue: '$title'..."
    gh issue create --title "$title" --body "$body" --label "$label" &>/dev/null
    
    if [ $? -eq 0 ]; then
        echo "✅ Successfully created issue '$title'!"
    else
        echo "⚠️  Note: Issue '$title' could not be created directly (might need auth or label setup)."
        echo "   You can create it manually using the details below:"
        echo "   Title: $title"
        echo "   Label: $label"
        echo "------------------------------------------------------------"
    fi
}

# Issue 1: Drawing Full-Text Search
read -r -d '' body_1 << 'EOF'
### Description
Implement a server-side extraction and search indexing system that extracts text elements from Excalidraw vector scene JSON files and indexes them in PostgreSQL to allow full-text query matching across all drawing whiteboards in a workspace.

### Core Deliverables
- [ ] **Extraction Hook:** Build a debounced backend parser hook that triggers on canvas state synchronization to extract all raw text strings from Excalidraw's element array.
- [ ] **Search Columns/Index:** Add a tsvector search column or GIN index to the File/Document schema using Prisma.
- [ ] **Search UI Dashboard:** Integrate a dedicated whiteboard search results panel in the team dashboard.

### Priority
High

### Milestone
M2: Real-time Collaboration Engine (Yjs/WebSockets)
EOF

create_issue "Feature: Full-Text Search Indexer for Canvas Drawings" "$body_1" "enhancement"

# Issue 2: Real-time Shared Asset Library Sync
read -r -d '' body_2 << 'EOF'
### Description
Enable team collaborators to publish custom drawing elements and `.excalidrawlib` packs directly to a shared organization asset catalog, synchronizing drawing utilities across all devices in real-time.

### Core Deliverables
- [ ] **Shared Catalog DB Model:** Create a new database table `SharedLibraryItem` to store stringified excalidraw element shapes.
- [ ] **Library Sync Triggers:** Broadcast socket state events to other workspace viewers when a library item is added or modified.
- [ ] **Community Import:** Integrate a curated tab allowing quick imports of open-source vector packs.

### Priority
High

### Milestone
M2: Real-time Collaboration Engine (Yjs/WebSockets)
EOF

create_issue "Feature: Real-time Shared Custom Asset Library for Teams" "$body_2" "enhancement"

# Issue 3: PDF Import & Canvas Markup
read -r -d '' body_3 << 'EOF'
### Description
Allow users to upload PDF documents directly onto the collaborative canvas as static background layers, enabling highlighting, drafting, system overlays, and engineering markup.

### Core Deliverables
- [ ] **PDF-to-Image / Native Canvas Overlay:** Create a canvas backdrop renderer that represents PDF pages as vector-panned background elements.
- [ ] **Markup Annotation Layers:** Build custom markup brush layers and text highlights that overlay the PDF elements.
- [ ] **Sleek File Dropper:** Add drag-and-drop file support to capture PDF inputs directly inside the whiteboard area.

### Priority
Medium

### Milestone
M3: Enterprise Security, Compliance & Visual History
EOF

create_issue "Feature: PDF Canvas Import & Annotation Markup System" "$body_3" "enhancement"

# Issue 4: Unified Command Palette
read -r -d '' body_4 << 'EOF'
### Description
Add a global keyboard-driven command palette overlay (`Cmd+K` / `Ctrl+K`) that enables lightning-fast navigation, workspace searching, configuration changes (dark/light theme toggles), and active team settings across the whole application.

### Core Deliverables
- [ ] **Command Overlay UI Component:** Render a backdrop-blur floating search input modal matching our premium design.
- [ ] **Omni-Search Index:** Aggregate files, folders, setting views, and active team lists inside a client-side match index.
- [ ] **Hotkeys Binding:** Integrate keyboard shortcut listeners for quick activation from any view.

### Priority
Medium

### Milestone
M3: Enterprise Security, Compliance & Visual History
EOF

create_issue "Feature: Unified Global Command Palette (Cmd+K)" "$body_4" "enhancement"

# Issue 5: GitHub Action PR Diagram Embed Sync
read -r -d '' body_5 << 'EOF'
### Description
Develop a self-contained GitHub Action that parses collaborative canvas drawings and dynamically embeds rendered images of the canvas drawings inside Pull Request descriptions and Markdown documentations, automatically updating them on commit push.

### Core Deliverables
- [ ] **Canvas-to-PNG Exporter API:** Implement a headless Next.js API route that loads and converts Excalidraw state JSON into an image buffer.
- [ ] **GitHub Action Workflow:** Write the action YAML file to fetch active canvas diagrams from the repository and insert them as Markdown images.
- [ ] **Dynamic Webhook Trigger:** Fire updates on file save or version checkout tags.

### Priority
Medium

### Milestone
M4: AI-Native MCP (Model Context Protocol) Server
EOF

create_issue "Feature: GitHub Action Integration for Automated PR Diagram Embeds" "$body_5" "enhancement"

# Issue 6: Native Image Upload & Embed Support in Rich Documents
read -r -d '' body_6 << 'EOF'
### Description
Allow team collaborators to upload, drag-and-drop, or paste images (PNG, JPG, SVG, GIF, WebP) directly inside the document rich text editor, rendering them alongside collaborative blocks with dynamic captions.

### Core Deliverables
- [ ] **Headless Media Upload API:** Build a secure API route `/api/files/upload` to receive multipart form-data and upload assets securely to Prisma-tracked storage.
- [ ] **Editor.js Image Block Integration:** Configure the `@editorjs/image` block tool in the workspace editor interface.
- [ ] **Interactive Drag & Drop & Paste Hooks:** Add window drag-over and window paste events to dynamically parse image clipboard items and trigger silent background uploads.
- [ ] **Dynamic Layout Controls:** Enable full-width, centered, or side-by-side image positioning blocks with customizable caption edit layers.

### Priority
High

### Milestone
M1: Advanced Interactive Workspace & File Hierarchies
EOF

create_issue "Feature: Native Image Upload & Embed Support inside Rich Documents" "$body_6" "enhancement"

echo "------------------------------------------------------------------"
echo "🎉 Feature requests generation sequence completed!"
echo "================================================================--"
