# Submitting CollabPro to the Claude Connectors Directory

Status: **not submitted** — blocked on the hosted-vs-self-hosted decision (see below). Everything technical is in place once OAuth is deployed.

## Decide first: which URL is the listing?
A directory listing has one URL. Listings whose users connect to *different* URLs (self-hosters) can only be published once Anthropic marks them **Verified**. Options:
1. **Hosted instance** at one fixed URL (e.g. `https://app.<your-domain>/api/mcp`) → listing publishes as Community by default. Self-hosters use *Add custom connector* ([Option C](mcp-integration.md#option-c--claude-claudeai--desktop--mobile-custom-connector)).
2. Self-hosted only → no directory listing; custom connector instructions only.

## Pre-submission checklist
- [ ] OAuth deployed and verified (`docs/runbooks/mcp.md` deploy checklist).
- [ ] Added as a custom connector in claude.ai and **every tool called** (the portal asks you to confirm).
- [ ] Every tool has a `title` and `readOnlyHint`/`destructiveHint` ✅ (see `lib/mcp/tools.ts`).
- [ ] Privacy policy URL, documentation URL (this repo's docs or a public page), support contact.
- [ ] Icon (the portal's Listing step states the accepted format/size).
- [ ] A fully populated **test account** for reviewers (team with files, a diagram, a document).
- [ ] Plugin bundle (`plugins/collabpro/`) — set `.mcp.json` to the same URL; submit it as a separate Plugin bundle pointing at the same server.

## Portal steps
Developer portal: <https://claude.ai/directory/manage> → **Submit new → MCP connector**. Steps: Connection (URL), Tools (synced), Listing (name ≤100, one-liner ≤200, description ≤2000, categories, docs + privacy URLs, support, icon, **permanent slug**), Use cases, Company, Authentication (**OAuth DCR**; nothing to enter), Data handling, Test & launch, Compliance (7 acknowledgments incl. prompt injection — answer from `mcp-threat-model.md`), Review & submit.

Reference: <https://claude.com/docs/connectors/building/submission>, <https://claude.com/docs/connectors/building/authentication>. Escalations: `mcp-review@anthropic.com`.
