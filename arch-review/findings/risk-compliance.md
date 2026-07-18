# Risk and Compliance Architecture Review

## Summary
The CollabPro architecture review reveals severe critical security and operational risks that mandate immediate remediation before production deployment. While the system successfully meets its stated goals of zero SaaS dependencies (falling back to a custom Redis/Postgres/S3-compatible architecture) and database agnosticism, its custom security implementations introduce critical vulnerabilities. Specifically, authentication and session management are completely compromised by plaintext passwords and forged cookie trust. Furthermore, operational debt surrounding database migrations exposes production environments to imminent data loss.

## Key Findings

### Critical
1. **Insecure Session Tokens (Authentication Bypass)**
   - **Description:** The system utilizes a custom cookie-based session auth (`lib/session-auth/server.ts`). However, the `session_token` is stored as an unencrypted, unsigned JSON string. The server blindly `JSON.parse()`s this cookie to authenticate users.
   - **Impact:** Any user can trivially forge their identity or elevate privileges to another user by modifying their browser cookie using DevTools.
2. **Plaintext Passwords Stored in Database**
   - **Description:** `app/api/auth/register/route.ts` and `app/api/auth/login/route.ts` write and compare user passwords in plaintext.
   - **Impact:** A complete compromise of all user credentials in the event of a database breach.
3. **Imminent Data Loss via Startup Database Migrations**
   - **Description:** The `package.json` start script (`"start": "prisma db push --accept-data-loss && next start"`) and Kubernetes documentation recommend running `prisma db push --accept-data-loss` on startup. 
   - **Impact:** In a production environment with scaling or schema drift, this will wipe tables or truncate data columns irreversibly without warning.

### High
1. **Cross-Site WebSocket Hijacking (CSWSH)**
   - **Description:** The standalone WebSocket gateway (`ws-server/server.ts`) relies exclusively on the `session_token` cookie for authentication and completely lacks an `Origin` header validation check during the `upgrade` event handshake.
   - **Impact:** Malicious websites visited by an authenticated user can silently connect to the WebSocket gateway, extracting real-time collaboration canvas data and mutating workspace files cross-origin.

### Medium
1. **Missing Open-Source License File**
   - **Description:** The `README.md` explicitly states the project is distributed under the MIT License and references a `[LICENSE](LICENSE)` file, but no such file exists in the repository root. Furthermore, `package.json` is marked `"private": true`.
   - **Impact:** Creates legal ambiguity and risks copyright infringement for organizations attempting to adopt or contribute to the open-source project.
2. **Deprecated Operational Dependencies**
   - **Description:** The project relies on `moment` (^2.30.1) for date parsing, which is officially deprecated.
   - **Impact:** Accrues operational and performance debt. Modern alternatives like `date-fns` or `dayjs` should be favored.

### Low
1. **Brittle Connection String Parsing**
   - **Description:** `lib/db.ts` uses manual string replacements to append `pgbouncer=true` and custom base64 encoded JSON parsing for connections. 
   - **Impact:** This approach is fragile and highly prone to runtime crashes if malformed database URLs are passed.

## Recommendations
- **Security:** Immediately integrate a secure hashing library (e.g., `bcrypt` or `argon2`) for passwords. Migrate the session mechanism to use cryptographically signed JSON Web Tokens (JWT) or server-side stored session IDs.
- **Operations:** Remove `--accept-data-loss` from all scripts. Replace `prisma db push` with `prisma migrate deploy` for production database operations.
- **Network:** Implement strict `Origin` header validation in `ws-server/server.ts` before upgrading HTTP requests to WebSockets.
- **Compliance:** Commit a valid `LICENSE` file (MIT) to the repository root and update `package.json` to reflect the open-source license.
