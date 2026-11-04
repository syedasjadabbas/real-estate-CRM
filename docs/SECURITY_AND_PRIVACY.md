# Security and Privacy (PROPOSED)

The CRM holds customer phone numbers, emails, budgets, call recordings, booking amounts and (with Finance) payment records. These are personal and financial data and must be protected.

## 1. Authentication

| Control | Design |
|---|---|
| Passwords | Argon2id hash; minimum 10 characters; block common passwords |
| Sessions | Random 256-bit token, stored hashed in the DB; HTTP-only, Secure, SameSite=Lax cookie; 12 h idle / 7 d absolute expiry; revoke on password change |
| Brute force | 5 failed logins / 15 min per email + **verified** client IP → temporary lock. Spoofed forwarded headers cannot reset it (implemented 30 Oct 2026, `PRODUCTION_READINESS_PLAN.md` §2). |
| Sign-in log | Every sign-in and sign-out with the verified client IP (from a trusted reverse proxy only; none otherwise) and user agent (capped at 512 characters). It is **authentication activity, never attendance** (My Workplace "CRM Sign-in History", Performance counts). |
| Client IP | Taken only from the header a trusted proxy overwrites (`TRUST_PROXY`, `TRUSTED_PROXY_COUNT`, optional `PROXY_SHARED_SECRET`). Browser-supplied `X-Forwarded-For` is never trusted; production without proxy configuration records no IP. See `DEPLOYMENT_PROXY.md`. |
| Account lifecycle | Admin creates users; deactivated users are blocked immediately (sessions revoked) |
| Password reset | Email token, 30 min expiry, single use (needs SMTP) |
| 2FA | Optional TOTP for admin / accountant: **later** (not in V1 unless confirmed) |

## 2. Authorization

- A central policy module decides `can(user, action, resource)` plus a record-scope filter (own / team / all) and the project scope. See `USER_ROLES_AND_PERMISSIONS.md`.
- Checks run on the **server** for every route, server action and export. The UI only hides controls.
- Records outside the user's scope return **404** to avoid leaking their existence.
- Sensitive actions (approve lost, confirm or cancel a booking, record or reverse a payment, change a role) need specific permissions and are audited.

## 3. Audit logging

- Append-only `audit_logs`: actor, action, entity, before / after diff of key fields, IP, timestamp. The IP is the verified client IP of the request (trusted proxy only, as for sign-ins); it is empty when untrusted or outside a web request (jobs), never taken from a browser header (since 4 Nov 2026, F-4).
- Audit logs and sign-in logs are separate tables. Sign-in log retention never deletes audit logs.
- Covers: lead stage, owner and lost changes, booking stage changes, unit status changes, payments and reversals, user and role changes, settings changes, exports, logins, and permission denials (sampled).
- Admins can view audit logs: **Settings → Audit log** (`/dashboard/settings/audit-log`, `GET /api/v1/audit-logs`), Super Admin and Admin only, read-only. Values under secret-looking keys (password, token, secret, API key) are hidden on display. Nobody can edit or delete them through the app.

## 4. Data isolation

- Single tenant (one client company). Data is separated by **project** and **team scope** in every query.
- No cross-project data leaks: the project ID is validated on every write (e.g. a booking unit must belong to the booking project).

## 5. Secrets management

- Secrets live in environment variables on the server (`.env` not committed), loaded by Docker Compose: DB URL, session secret, S3 keys, Meta / TikTok app secrets, SMTP.
- `.env.example` in the repo lists keys without values.
- Rotate secrets at handover. All third-party accounts must be registered under the **client's** name.

## 6. File uploads

- Allow-list MIME types and extensions: audio (`mp3`, `m4a`, `aac`, `ogg`, `wav`), documents (`pdf`, `jpg`, `png`, `docx`, `xlsx`).
- Size limits: audio 25 MB, documents 10 MB.
- Uploads go directly to a **private** bucket via short-lived pre-signed URLs. Downloads use signed URLs (≤ 10 min).
- Random storage keys; original filenames are stored only as metadata. Files are never served from the app's public folder.
- Optional virus scan (ClamAV) later.

## 7. Transport and application security

- HTTPS everywhere (Caddy auto-TLS), HSTS.
- Security headers: CSP (self + storage domain), X-Frame-Options DENY, Referrer-Policy, X-Content-Type-Options.
  - **Implemented 31 Oct 2026** in `next.config.ts`: CSP (self only; storage is local, so there is no storage domain), X-Frame-Options DENY, Referrer-Policy `same-origin`, nosniff and HSTS (1 year).
  - Exact values and the reasons for `'unsafe-inline'` are in `DEPLOYMENT_PROXY.md` §11.
- CSRF: SameSite cookies + Origin check on state-changing requests (server actions include this).
- Input validation with Zod; parameterised queries via the ORM. Output escaping by React.
- Rate limiting (see `API_DESIGN.md`).
- Dependency scanning (`npm audit` / Dependabot) in CI.
- Webhooks: verify signatures; reject unsigned requests.

## 8. Financial data protections (Accounts & Finance)

- Payments and income / expense entries are **never hard-deleted**. Corrections use reversal entries linked to the original.
- Sequential receipt numbers; no gaps on reversal.
- Only the Accountant and Super Admin roles can write finance data. Admin can read it.
- Totals (booking paid, balances) are recomputed from entries, not typed in by hand.
- Monthly CSV export for the client's accountant; exports are audited.

## 9. Backups and recovery

- Nightly `pg_dump`, encrypted, copied off-server (object storage, separate bucket). Keep 7 daily + 4 weekly + 3 monthly.
- Object storage versioning on (recordings and documents).
- A documented restore procedure, tested once before go-live.
- Backup and hosting costs are client-paid. **Who monitors backups after handover must be agreed**, since maintenance is not included.

## 10. Privacy

- Collect only what the business needs. CNIC and similar IDs are stored only if confirmed, and masked in lists.
- Phone numbers and emails are visible only to users with access to that lead or client.
- Call recordings may contain sensitive conversations. Access is restricted to the lead owner, their managers and admins.
- Sending recordings to a third-party AI provider (later phase) requires client approval and a disclosure to customers if required.
- Data retention: leads are kept indefinitely unless deleted by an admin (proposed). **Sign-in logs:** a configurable retention period (3–120 months, **12 proposed**) is set on Security settings by a super admin or admin. A daily job (`npm run job:prune-signin-logs`, with `--dry-run`) deletes older sign-in history **only when automatic deletion is switched on**, which stays **off until the client approves (C2)**. Audit logs are never deleted. See `DEPLOYMENT_PROXY.md` §7–8. ⚠ Period and activation to confirm.
- Exports (CSV / PDF) are limited to admin / accountant and logged.
- Migration data from the old CRM is handled only on the client's systems and deleted from developer machines after import.

## 11. Pre-go-live security checklist

- [ ] Default and demo accounts removed; admin password changed
- [ ] Permission matrix tests pass for every role
- [ ] HTTPS and security headers verified
- [ ] Backups run and one restore tested
- [ ] Secrets rotated and stored only on the server
- [ ] Bucket is private; signed URLs expire
- [ ] Error pages expose no stack traces
- [ ] App port reachable only from the reverse proxy; `TRUST_PROXY` set; spoofing check in `DEPLOYMENT_PROXY.md` §5 passed
- [ ] Daily `job:prune-signin-logs` scheduled; retention policy confirmed by the client before automatic deletion is switched on
