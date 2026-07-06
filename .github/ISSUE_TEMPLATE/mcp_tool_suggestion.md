---
name: "🤖 MCP Tool Suggestion"
about: Propose a new tool endpoint or JSON-RPC schema modification for the CollabPro Model Context Protocol Server.
title: "[MCP-TOOL] "
labels: ["mcp", "ai-agent"]
assignees: []
---

### Proposed MCP Tool Name
What should the JSON-RPC tool name be? (e.g., `collabpro_add_comment_bubble`)

### Use Case
Describe how an AI Coding Agent (like Cursor or Claude Desktop) would leverage this tool. For example: "It allows the agent to leave interactive review notes on a drawing."

### Proposed JSON Schema / Parameters
Please outline the expected JSON input schema parameters:
```json
{
  "type": "object",
  "properties": {
    "fileId": { "type": "string", "description": "Target document id" }
  },
  "required": ["fileId"]
}
```

### Expected Output Payload
Describe the data parameters returned by the tool back to the AI Agent.
```json
{
  "success": true,
  "commentId": "comm_1234"
}
```
