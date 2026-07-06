#!/bin/bash
# ==============================================================================
# CollabPro — GitHub Milestone Generator Script
# This script uses the GitHub CLI (gh) to generate the professional milestones 
# on your repository based on our Enterprise Roadmap.
# ==============================================================================

# Ensure gh CLI is authenticated and available
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
echo "🛡️  CollabPro GitHub Milestone Creator"
echo "=================================================================="
echo "Found Remote Repository: $REPO_URL"
echo "This script will create 4 major milestones on your repository."
echo "Please make sure you are authenticated in this shell."
echo "------------------------------------------------------------------"

# Function to create a milestone
create_milestone() {
    local title="$1"
    local description="$2"
    local due_date="$3"
    
    echo "Creating milestone: '$title'..."
    # Attempt to create the milestone via gh api
    gh api repos/:owner/:repo/milestones \
        -f title="$title" \
        -f description="$description" \
        -f due_date="$due_date" \
        --silent 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo "✅ Successfully created '$title'!"
    else
        # Fallback to standard CLI command
        gh milestone create --title "$title" --description "$description" --due-date "$due_date" &>/dev/null
        if [ $? -eq 0 ]; then
            echo "✅ Successfully created '$title'!"
        else
            echo "⚠️  Note: Milestone '$title' might already exist or needs auth permissions."
        fi
    fi
}

# Create Milestone 1
create_milestone "M1: Performance Foundation & Co-presence" \
"Smart Adaptive Polling, Prisma Database Connection Pooling, and Workspace Header Presence Pile UI. Target: Weeks 1-2." \
"2026-07-20"

# Create Milestone 2
create_milestone "M2: Real-time Collaboration Engine (Yjs/WebSockets)" \
"Transitioning storage to Yjs CRDTs, launching a WebSocket Gateway, real-time cursor streams, and the granular ShareModal permissions center. Target: Weeks 3-5." \
"2026-08-10"

# Create Milestone 3
create_milestone "M3: Enterprise Security, Compliance & Visual History" \
"Visual version history sidebar, admin control settings (SSO, seat indicators), DB audit log templates, and Docker/Kubernetes container packaging. Target: Weeks 6-8." \
"2026-08-31"

# Create Milestone 4
create_milestone "M4: AI-Native MCP (Model Context Protocol) Server" \
"Building the official CollabPro MCP server (JSON-RPC 2.0 over Stdio/SSE) allowing Cursor/Claude agents to write canvas sketches and documents. Target: Release Phase." \
"2026-09-30"

echo "------------------------------------------------------------------"
echo "🎉 Milestone generation sequence completed!"
echo "Check your GitHub issues/milestones page to view the live timeline."
echo "=================================================================="
