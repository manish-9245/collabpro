# Architecture Review: Security Architect Findings
**Target:** CollabPro
**Date:** 2026-07-18

## Summary
The CollabPro application architecture lacks fundamental security mechanisms around authentication, authorization, and data protection. Several critical vulnerabilities allow complete system compromise, including unauthorized access to all user accounts, widespread IDORs leading to unauthorized viewing and mutation of resources (files, whiteboards, teams), and the leakage and plain-text storage of user credentials. Additionally, significant Cross-Site Scripting (XSS) and Server-Side Request Forgery (SSRF) vulnerabilities were identified. Immediate remediation is required before the system can be considered secure for deployment.

## Key Findings

### Critical
1. **Broken Authentication (Session Cookie Forgery):**
   The application authenticates users via a `session_token` cookie that simply stores an unencrypted, unsigned JSON string containing the user's ID, email, name, and image (`/api/auth/login`, `/api/auth/register`). The backend blindly parses this JSON using `JSON.parse(cookie)` to determine the authenticated user (`/api/auth/me`, `lib/session-auth/server.ts`, `ws-server/server.ts`). An attacker can forge this cookie to perfectly impersonate and hijack any user account in the system without requiring their password.
2. **Cleartext Password Storage & Sensitive Data Leakage:**
   Passwords are stored in cleartext in the PostgreSQL database instead of being hashed (`/api/auth/register/route.ts`). Furthermore, the `user:getUserProfile` operation in `/api/state-sync/route.ts` returns the complete Prisma `User` record to other users within the same team. This means any team member can easily query the API to view the cleartext passwords of all other members in their team.
3. **Broken Access Control (IDOR) on WebSocket Gateway:**
   The WebSockets server (`ws-server/server.ts`) allows users to subscribe to and execute mutations (e.g., `files:updateDocument`, `files:updateWhiteboard`, `files:updateFileName`) without any file-level or team-level authorization checks. An attacker can connect via WebSocket and provide any arbitrary `fileId` to read or overwrite another user's or team's documents and whiteboards.
4. **Broken Access Control (IDOR) on State-Sync API:**
   The central GraphQL/RPC-style endpoint `/api/state-sync/route.ts` inherently trusts user-supplied input parameters for authorization checks. For instance:
   - In `teams:deleteTeam`, the attacker can pass the true team owner's email via the `ownerEmail` argument to bypass the `team.createdBy !== ownerEmail` check and delete any team.
   - In `teams:removeMember` and `teams:leaveTeam`, an attacker can specify `userEmail` and `ownerEmail` inside `args` to forcefully remove users from teams.
   - Mutations like `files:updateDocument` are executed via `FileService` without verifying if the authenticated user has edit access to the file.
5. **Broken Access Control (IDOR) on Export API:**
   The `/api/export/route.ts` endpoint accepts a `fileId` query parameter to generate an SVG export of the whiteboard but fails to perform any authentication or authorization checks. Anyone can read the complete visual contents of any whiteboard simply by knowing or guessing its UUID.

### High
1. **Stored Cross-Site Scripting (XSS) via Vector Export Injection:**
   The `/api/export/route.ts` endpoint dynamically builds an SVG by interpolating user-controlled whiteboard element attributes (such as `strokeColor`, `backgroundColor`, and `text`) directly into the XML response without adequate sanitization. An attacker can set `strokeColor` to `"><script>alert(1)</script><"` via the `collabpro_update_whiteboard` API, which will be executed in the context of the application's origin when a victim opens the exported SVG.
2. **Stored Cross-Site Scripting (XSS) via SVG Uploads:**
   The image upload functionality (`/api/upload/route.ts`) validates image magic bytes but accepts any file containing `<svg` or `<?xml`. These files are then served via `/api/upload/[id]/route.ts` with `Content-Type: image/svg+xml` without a restrictive `Content-Security-Policy` header or `Content-Disposition: attachment`. An attacker can upload malicious SVGs with embedded JavaScript to execute XSS attacks on victims.
3. **SSRF Filter Bypass via DNS Rebinding (TOCTOU):**
   The `/api/upload/route.ts` endpoint attempts to prevent SSRF by resolving the provided image URL to its IP address and validating it against local/private network ranges (`isSafeUrl`). However, after validation, it issues a `fetch(imageUrl)` which initiates a second DNS lookup. This Time-of-Check to Time-of-Use (TOCTOU) vulnerability allows attackers to bypass the filter using DNS rebinding, potentially accessing internal AWS metadata or backend services.
4. **Weak Cryptography for Share Link Passwords:**
   Share link passwords are hashed using plain SHA-256 without a salt (`/api/share/verify/route.ts`). This implementation is susceptible to dictionary attacks and rainbow tables. 

### Medium
1. **Functional/Security Configuration Mismatch in MCP Implementation:**
   The API Key middleware (`lib/api-key-middleware.ts`) blocks HTTP POST requests for keys provisioned with the `read-only` scope. However, the MCP implementation (`/api/mcp/route.ts`) acts as a JSON-RPC server that exclusively accepts POST requests. Consequently, `read-only` API keys are functionally broken and completely unusable for MCP, forcing users to grant dangerous `read-write` access to integrations just to perform read operations.
2. **Missing Rate Limiting:**
   Sensitive endpoints such as authentication, registration, file uploads, and WebSocket connections lack rate limiting, exposing the system to brute force attacks and application-level Denial of Service.

### Low
1. **Verbose Error Messages:**
   Multiple API routes log and return raw exception messages directly to the client (e.g., `error.message` on `/api/upload` and WebSocket mutations).

## Recommendations
- **Implement Cryptographic Session Management:** Replace the unencrypted `session_token` cookie with a securely signed stateless token (e.g., JSON Web Tokens using HMAC-SHA256) or a stateful, opaque session ID stored securely in the database/Redis.
- **Enforce Strong Password Hashing:** Immediately migrate user passwords and share link passwords to a strong, salted hashing algorithm such as Argon2id or bcrypt.
- **Implement Universal Authorization Checks:** Introduce strict, centralized authorization logic. Before performing any read or write operation on files, whiteboards, or teams (over both REST and WebSockets), the backend must fetch the entity and explicitly verify that the authenticated `sessionUser.id` holds the required access permissions.
- **Parameter Validation & Principle of Least Privilege:** Do not trust user-supplied parameters for authorization controls (e.g., `ownerEmail`, `userEmail` in `state-sync`). Always determine the context (who is performing the action) strictly from the trusted session token.
- **Sanitize and Restrict SVG Handling:** Block SVG uploads or implement strict XML sanitization (e.g., DOMPurify) before saving them. On endpoints like `/api/upload/[id]` and `/api/export`, serve files with `Content-Security-Policy: default-src 'none';` and ensure attributes in `/api/export` are fully HTML-escaped.
- **Fix SSRF DNS Rebinding:** Prevent DNS rebinding by performing the `fetch` using the exact IP address resolved during the validation phase, or by utilizing an HTTP agent configured to strictly block internal IP addresses at the socket level.
- **Correct MCP Read-Only Key Handling:** Modify the API Key middleware to recognize JSON-RPC `method` properties over POST for the MCP endpoint, permitting read-only operations (e.g., `collabpro_list_files`, `collabpro_get_file`) while blocking mutations.
