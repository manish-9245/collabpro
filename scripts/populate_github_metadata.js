const { execSync } = require('child_process');

async function run() {
    try {
        console.log("==================================================================");
        console.log("🛡️  CollabPro GitHub Metadata Populator");
        console.log("==================================================================");

        // 1. Get the gh auth token
        let token;
        try {
            token = execSync('gh auth token', { encoding: 'utf-8' }).trim();
            console.log("🔑 GitHub Token successfully retrieved.");
        } catch (err) {
            console.error("❌ Error: Could not retrieve GitHub token using 'gh auth token'.");
            console.error("Please make sure you are authenticated with the 'gh' CLI in your shell.");
            process.exit(1);
        }

        const owner = "manish-9245";
        const repo = "collabpro";
        const baseUrl = "https://api.github.com";

        // Helper fetch wrapper
        async function apiRequest(endpoint, method = "GET", body = null) {
            const options = {
                method,
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                    "User-Agent": "collabpro-setup"
                }
            };
            if (body) {
                options.body = JSON.stringify(body);
                options.headers["Content-Type"] = "application/json";
            }
            const response = await fetch(`${baseUrl}${endpoint}`, options);
            if (!response.ok) {
                const text = await response.text();
                throw new Error(`GitHub API Error: ${response.status} ${response.statusText} - ${text}`);
            }
            return await response.json();
        }

        // 2. Fetch existing milestones
        console.log("🔍 Fetching existing milestones...");
        const existingMilestones = await apiRequest(`/repos/${owner}/${repo}/milestones?state=all`);
        const milestoneMap = {}; // Maps milestone title to its number
        existingMilestones.forEach(m => {
            milestoneMap[m.title] = m.number;
            console.log(`- Found milestone: "${m.title}" (Number: ${m.number})`);
        });

        // Milestones to create
        const milestonesToCreate = [
            {
                title: "M1: Performance Foundation & Co-presence",
                description: "Smart Adaptive Polling, Prisma Database Connection Pooling, and Workspace Header Presence Pile UI. Target: Weeks 1-2.",
                due_on: "2026-07-20T23:59:59Z"
            },
            {
                title: "M2: Real-time Collaboration Engine (Yjs/WebSockets)",
                description: "Transitioning storage to Yjs CRDTs, launching a WebSocket Gateway, real-time cursor streams, and the granular ShareModal permissions center. Target: Weeks 3-5.",
                due_on: "2026-08-10T23:59:59Z"
            },
            {
                title: "M3: Enterprise Security, Compliance & Visual History",
                description: "Visual version history sidebar, admin control settings (SSO, seat indicators), DB audit log templates, and Docker/Kubernetes container packaging. Target: Weeks 6-8.",
                due_on: "2026-08-31T23:59:59Z"
            },
            {
                title: "M4: AI-Native MCP (Model Context Protocol) Server",
                description: "Building the official CollabPro MCP server (JSON-RPC 2.0 over Stdio/SSE) allowing Cursor/Claude agents to write canvas sketches and documents. Target: Release Phase.",
                due_on: "2026-09-30T23:59:59Z"
            }
        ];

        // Create missing milestones
        for (const m of milestonesToCreate) {
            if (milestoneMap[m.title]) {
                console.log(`✅ Milestone "${m.title}" already exists.`);
            } else {
                console.log(`➕ Creating milestone: "${m.title}"...`);
                try {
                    const newMilestone = await apiRequest(`/repos/${owner}/${repo}/milestones`, "POST", m);
                    milestoneMap[m.title] = newMilestone.number;
                    console.log(`✅ Created milestone: "${m.title}" with Number ${newMilestone.number}`);
                } catch (err) {
                    console.error(`❌ Failed to create milestone "${m.title}":`, err.message);
                }
            }
        }

        // 3. Fetch existing issues to avoid duplicates
        console.log("🔍 Fetching existing issues...");
        const existingIssues = await apiRequest(`/repos/${owner}/${repo}/issues?state=all&per_page=100`);
        const issueMap = new Set(existingIssues.map(i => i.title));

        // Issues to create
        const issuesToCreate = [
            // Milestone 1
            {
                title: "Smart Adaptive Polling System",
                milestoneTitle: "M1: Performance Foundation & Co-presence",
                body: `### Description
Implement an active-backoff system for document polling. When the browser tab is unfocused or the user is inactive, dynamically scale down polling from \`4s\` to \`15s\`.

### Goals
- Reduce server CPU overhead and database connection strain.
- Detect browser tab visibility API events (\`visibilitychange\`).
- Implement smooth poll resumption when the user refocuses the page.`,
                labels: ["performance", "enhancement"]
            },
            {
                title: "Prisma Connection Pooling (pgBouncer setup)",
                milestoneTitle: "M1: Performance Foundation & Co-presence",
                body: `### Description
Configure Prisma with connection pooling via pgBouncer in PostgreSQL. Enable pre-allocated pool limits to ensure the database can handle up to 500 concurrent connections.

### Goals
- Ensure PostgreSQL never rejects active user socket connections.
- Optimize connection reuse under heavy collaborative loads.
- Configure \`connection_limit\` in the Prisma URL parameters appropriately.`,
                labels: ["backend", "database"]
            },
            {
                title: "Live Collaborator Presence Pile UI",
                milestoneTitle: "M1: Performance Foundation & Co-presence",
                body: `### Description
Create a beautiful presence avatar stack in the workspace header. Render active collaborators in real-time (e.g. \`(JD) (ST) (AW) +3\`) with hover cards showing details, custom colors, and workspace status.

### Goals
- Real-time updates as users enter/exit documents.
- Polished, enterprise-grade hover states.
- Fluid layout animation when adding or removing avatars.`,
                labels: ["frontend", "ui/ux"]
            },

            // Milestone 2
            {
                title: "Yjs CRDT Integration for Whiteboard & Editors",
                milestoneTitle: "M2: Real-time Collaboration Engine (Yjs/WebSockets)",
                body: `### Description
Convert the storage layers of both Excalidraw canvas and Editor.js text blocks into conflict-free replicated data types (CRDTs) using Yjs.

### Goals
- Prevent state collisions or overwrite issues.
- Absolute data convergence across multiple active participants.
- Preserve document structures in offline-friendly binary chunks.`,
                labels: ["architecture", "real-time"]
            },
            {
                title: "High-Performance WebSocket Gateway Server",
                milestoneTitle: "M2: Real-time Collaboration Engine (Yjs/WebSockets)",
                body: `### Description
Stand up a high-performance, standalone WebSocket server alongside the Next.js stack to handle live synchronization and streaming of Yjs state updates.

### Goals
- Setup robust WebSocket handshake and reconnection logic.
- Secure token-based WebSocket connection authentication.
- Deploy rooms to isolate collaborators to specific documents.`,
                labels: ["backend", "infrastructure"]
            },
            {
                title: "Multiplayer Floating Cursor Streams",
                milestoneTitle: "M2: Real-time Collaboration Engine (Yjs/WebSockets)",
                body: `### Description
Capture and broadcast user mouse coordinate events at 60fps, rendering smooth floating cursor elements with name tags and custom colors on top of the shared canvas.

### Goals
- High-frequency cursor position broadcasting using lightweight binary frames.
- Render smooth movements with animation easing (CSS transitions or interpolation).
- Clean up inactive cursors after a short inactivity timeout.`,
                labels: ["frontend", "real-time"]
            },
            {
                title: "Enterprise ShareModal with Granular Controls",
                milestoneTitle: "M2: Real-time Collaboration Engine (Yjs/WebSockets)",
                body: `### Description
Design and build a professional, premium-grade ShareModal supporting password protection, link expiration dates, and role customization (Viewer, Commenter, Editor).

### Goals
- Fully customizable sharing scopes.
- Backed by secure database schema constraints for shared links.
- Sleek and visual modern interface adhering to GrahakAI style rules.`,
                labels: ["frontend", "security"]
            },

            // Milestone 3
            {
                title: "Interactive Visual Version History Side-Drawer",
                milestoneTitle: "M3: Enterprise Security, Compliance & Visual History",
                body: `### Description
Build a vertical history drawer in the workspace to view historical snapshots, tag specific releases, and restore previous versions of canvas or documents.

### Goals
- Capture delta changes on save or periodic checkpoints.
- Allow naming and tagging of versions (e.g., "v1.0 Approved Blueprint").
- Seamless rollback capabilities with complete UI feedback.`,
                labels: ["frontend", "data-integrity"]
            },
            {
                title: "Organization Admin Settings Control Center",
                milestoneTitle: "M3: Enterprise Security, Compliance & Visual History",
                body: `### Description
Develop the organization settings dashboard under \`/dashboard/settings/admin\` with member grids, active seat counters, domain restricts, and SSO triggers.

### Goals
- Seat monitoring and invitation control.
- Domain restriction rules (e.g. only allow \`*@enterprise.com\` sign-ups).
- SAML/OIDC single sign-on initial configurations.`,
                labels: ["frontend", "admin-dashboard"]
            },
            {
                title: "Compliance Audit Logging Integration",
                milestoneTitle: "M3: Enterprise Security, Compliance & Visual History",
                body: `### Description
Create robust database models and lifecycle hooks to log security-sensitive team actions (file deletions, link sharing modifications, membership invites).

### Goals
- Write audit logs to an immutable PostgreSQL table.
- Log details: User ID, IP, Action, Timestamp, and Context.
- Expose audit history in the administrative panel with CSV export.`,
                labels: ["backend", "compliance"]
            },
            {
                title: "Docker Compose & Helm Chart Packaging",
                milestoneTitle: "M3: Enterprise Security, Compliance & Visual History",
                body: `### Description
Package the entire CollabPro stack (Next.js, database, WebSocket gateway) into clean, production-ready multi-stage Dockerfiles and Helm charts.

### Goals
- Facilitate one-click private-cloud deployments.
- Build hardened container images with non-root security contexts.
- Write a detailed deployment guide for Kubernetes.`,
                labels: ["devops", "enterprise-infra"]
            },

            // Milestone 4
            {
                title: "CollabPro MCP Server Module (JSON-RPC 2.0)",
                milestoneTitle: "M4: AI-Native MCP (Model Context Protocol) Server",
                body: `### Description
Implement the Model Context Protocol (MCP) server running over standard input/output (Stdio) and Server-Sent Events (SSE) transports.

### Goals
- Complies fully with standard JSON-RPC 2.0 schemas.
- Exposes secure platform APIs to AI coding assistants (Claude, Cursor).
- Authenticate agents securely via organizational API Keys.`,
                labels: ["mcp", "architecture"]
            },
            {
                title: "MCP File & Document Inspection Tools",
                milestoneTitle: "M4: AI-Native MCP (Model Context Protocol) Server",
                body: `### Description
Develop MCP tools \`collabpro_list_files\` and \`collabpro_get_file\` to let AI agents query and read specific documents or canvas configurations.

### Goals
- Feed structured text and Markdown content directly into Claude/Cursor context.
- Handle workspace authorization and access lists.
- Optimize content truncation for large canvas coordinates.`,
                labels: ["mcp", "tools"]
            },
            {
                title: "MCP Whiteboard & Document Editing Tools",
                milestoneTitle: "M4: AI-Native MCP (Model Context Protocol) Server",
                body: `### Description
Develop MCP tools \`collabpro_update_whiteboard\` and \`collabpro_update_document\` enabling agents to generate database schemas, AWS charts, and documentation automatically.

### Goals
- Allow AI-assisted visual sketch creation and editing.
- Automate document and canvas modifications on behalf of the developer.
- Build reliable conflict-resolution mechanisms for simultaneous human-agent edits.`,
                labels: ["mcp", "tools"]
            }
        ];

        // Create issues and associate them with milestones
        for (const issue of issuesToCreate) {
            if (issueMap.has(issue.title)) {
                console.log(`✅ Issue "${issue.title}" already exists.`);
            } else {
                const milestoneNumber = milestoneMap[issue.milestoneTitle];
                if (!milestoneNumber) {
                    console.error(`⚠️ Milestone "${issue.milestoneTitle}" not found. Skipping issue "${issue.title}".`);
                    continue;
                }

                console.log(`➕ Creating issue "${issue.title}" for Milestone ${milestoneNumber}...`);
                const payload = {
                    title: issue.title,
                    body: issue.body,
                    milestone: milestoneNumber,
                    labels: issue.labels
                };

                try {
                    const newIssue = await apiRequest(`/repos/${owner}/${repo}/issues`, "POST", payload);
                    console.log(`✅ Created issue: "${newIssue.title}" (#${newIssue.number})`);
                    issueMap.add(issue.title);
                } catch (err) {
                    console.error(`❌ Failed to create issue "${issue.title}":`, err.message);
                }
            }
        }

        console.log("==================================================================");
        console.log("🎉 SUCCESS! Milestone and Issue metadata successfully updated!");
        console.log("==================================================================");

    } catch (err) {
        console.error("❌ Program failed with error:", err.message);
    }
}

run();
