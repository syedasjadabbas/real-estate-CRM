# Production readiness — IP logging, sign-in log retention, attendance separation

Status: **implemented and verified, 30–31 Oct 2026 (§7).** D1–D4 approved as recommended. C1–C3 use the proposed defaults: sign-ins are never attendance; 12 months is proposed with **automatic deletion off**; Caddy is documented and CDN settings are pending.

Inspected:
- `src/server/auth/current-user.ts` (`requestMeta`), `login.ts`, `rate-limit.ts`, `session-store.ts`.
- The login / logout server actions and the `/api/v1/auth/*` routes.
- `node_modules/next/dist/server/base-server.js` (how Next.js sets `x-forwarded-*`).
- `next.config.ts`, `package.json` scripts, `.env.example`, `scripts/`.
- `src/server/db/schema.ts` (`signin_logs`, `sessions`, `audit_logs`, `app_settings`) and `src/modules/tasks/settings.ts`, the only settings code.
- Performance, My Workplace, HR and navigation code.
- `SYSTEM_ARCHITECTURE.md`, `SECURITY_AND_PRIVACY.md`, `REQUIREMENTS.md`, `HR_MODULE_PLAN.md`, `PERFORMANCE_MODULE_PLAN.md`, `MY_WORKPLACE_MODULE_PLAN.md`, `MODULES_AND_FEATURES.md`.

---

## 1. Findings

### 1.1 IP address extraction (security issue)

| Fact | Detail |
|---|---|
| Where the IP comes from | `requestMeta()` takes the **first** entry of `X-Forwarded-For`, then `X-Real-IP`, otherwise null. No proxy is checked and the value is not validated. |
| What Next.js does | `base-server.js`: `req.headers['x-forwarded-for'] ??= socket.remoteAddress`. Next.js fills the header from the real connection **only when it is missing**. If a browser sends its own `X-Forwarded-For`, Next.js keeps it unchanged. |
| Peer address | App Router code (route handlers, server actions) cannot see the TCP peer address. So the app **cannot check in code whether a request came through a trusted proxy**. Trust has to come from network isolation (or a shared secret), plus a proxy that overwrites the header. |
| Who uses the IP | `signin_logs.ip` (sign-in and sign-out), `sessions.ip`, and **the login rate-limit key** (`email + "|" + ip`). |
| Spoofing impact | (1) Anyone can write any IP into their own sign-in history and sessions. (2) **The login rate limit (5 failures / 15 min) can be bypassed** by sending a different `X-Forwarded-For` value on each attempt, because each value creates a new limiter key. |
| Other values | `user_agent` is also client-supplied and stored with no length limit. Node caps total headers at about 16 KB, but there is no explicit limit. |
| `audit_logs.ip` | The column exists but nothing writes to it. |

### 1.2 Deployment setup

- **No deployment files exist in the repository**: no Dockerfile, compose file, Caddyfile, nginx config, PM2 or systemd units. `npm start` is `next start` with no host or port options.
- `SYSTEM_ARCHITECTURE.md` documents the **planned** deployment: one VPS with Docker Compose (app, worker, Postgres) behind **Caddy** for TLS, deployed over SSH. This is documented intent, not something in the repo, and the hosting provider is not fixed.
- `.env.example` only has the two database URLs.

### 1.3 Sign-in log retention

| Fact | Detail |
|---|---|
| `signin_logs` | `id`, `user_id` (FK users, **on delete cascade**), `event`, `ip`, `user_agent`, `at`. Index `(user_id, at)`; there is no index on `at` alone. |
| Cleanup today | **None.** `pruneExpiredSessions` exists for `sessions` but nothing calls it. There is no worker, cron or job runner (the pg-boss worker in the architecture doc was never built). |
| Settings mechanism | `app_settings` (`key`, `value`, `updated_by_id`, `updated_at`) already exists. `tasks/settings.ts` shows the pattern: an admin-only update in a transaction, with one `audit_logs` row (`app.setting`) per changed key. **No new table is needed.** |
| Policy | `SECURITY_AND_PRIVACY.md`: "sign-in logs for 12 months. ⚠ To confirm." |
| Volume | About 10 users, so a few thousand rows a year. Deleting by date is cheap even without an index on `at`. |
| Other readers | Performance counts sign-ins in a date range; My Workplace lists them. Once old rows are deleted, ranges older than the retention period will show fewer sign-ins. That is expected, but it needs a note on the page. |

### 1.4 Attendance wording

Places where sign-in counts are presented as attendance:

| Where | Current text | Problem |
|---|---|---|
| Performance header (`performance/page.tsx`) | "Agent KPIs and **CRM attendance** for your scope (same metrics as team reports)." | Calls sign-ins attendance |
| Performance table title | "**Performance & attendance**" | Same |
| Sidebar description for Performance (`navigation.ts`) | "Agent KPIs and **CRM attendance** for your scope." | Same |
| `REQUIREMENTS.md` FR-143 | "Attendance: sign-in log based (no biometric)." | The requirement itself equates the two |
| `HR_MODULE_PLAN.md` | Q-H2 default "Sign-ins only (already shown in Performance and My Workplace)"; §10 "attendance via sign-ins"; §3 "sign-in counts already appear in Performance" | Docs treat sign-ins as the attendance default |
| `PERFORMANCE_MODULE_PLAN.md`, `MODULES_AND_FEATURES.md` | "CRM attendance", "Attendance: CRM sign-ins only (INFERRED)" | Same |

What is already correct:
- No code calculates hours, durations, late arrivals, absences or presence. Performance only counts `sign_in` / `sign_out` events in a range.
- The Performance "Critical" flag doesn't use sign-ins (it has no data yet).
- My Workplace already says it shows no attendance or durations.
- HR has no attendance screen.

Note: the "CRM attendance" wording was **copied from the SaleStorm reference** (OBSERVED). Changing it is a deliberate departure from the reference, following this instruction.

---

## 2. Plan — secure IP logging

### 2.1 Approach (works with any host)

The app cannot see the peer address (§1.1), so trust has two parts:
1. **Network:** the Node server is reachable **only** from the reverse proxy: bound to `127.0.0.1` or a private Docker network, never published on a public port.
2. **Proxy:** the reverse proxy **overwrites** `X-Forwarded-For` with the address it actually received the connection from, ignoring whatever the browser sent.

The app then trusts forwarded headers **only when told to by configuration**, and otherwise records no IP rather than a value that could be faked.

### 2.2 Configuration (new, all optional, in `.env.example`)

| Variable | Default | Meaning |
|---|---|---|
| `TRUST_PROXY` | `false` | Use forwarded headers only when `true`. |
| `TRUSTED_PROXY_COUNT` | `1` | How many trusted proxies sit in front of the app. The client IP is the entry this many places from the **right** of `X-Forwarded-For`; anything a browser added appears further left and is ignored. |
| `CLIENT_IP_HEADER` | `x-forwarded-for` | Or a single-value header the proxy overwrites, such as `x-real-ip`. |
| `PROXY_SHARED_SECRET` | unset | Optional extra check: when set, forwarded headers are trusted only if the request carries `X-Proxy-Secret` with this value (compared in constant time). It protects against the app port being exposed by mistake. |

### 2.3 Behaviour

| Situation | Recorded IP |
|---|---|
| `TRUST_PROXY=true`, header valid (and secret matches if set) | The client IP from the configured position |
| `TRUST_PROXY=true`, secret set but missing or wrong | **null**, with a one-time warning in the server log |
| `TRUST_PROXY` unset or false, **production** | **null** ("not recorded"), with a one-time warning at the first sign-in. The app fails closed rather than storing a spoofable value. |
| `TRUST_PROXY` unset, **development / test** (`NODE_ENV !== "production"`) | As today: the address Next.js puts in the header (`::1` locally). Localhost keeps working. |
| Value is not a valid IP (garbage, too long, too few entries for the hop count) | null |

Normalising: trim; strip IPv6 brackets and ports (`[::1]:3000` → `::1`, `1.2.3.4:5678` → `1.2.3.4`); turn `::ffff:1.2.3.4` into `1.2.3.4`; check with `node:net` `isIP`; ignore headers over 1 KB.

User agent: stored as received but **capped at 512 characters**.

### 2.4 Code changes

- New `src/server/auth/client-ip.ts`: a pure function `resolveClientIp(headers, config)` and `readProxyConfig(env)`. No Next.js imports, so it is fully unit-testable.
- `requestMeta()` calls it. **This is the only change in the auth area.** Login, sessions, cookies, expiry and the logout flow are untouched.
- Side effect: the **login rate-limit key uses the corrected IP** (decision **D1**). Rotating `X-Forwarded-For` no longer resets the limit. When the IP is null in production, the key becomes `email|unknown`, so the limit applies per email.
- My Workplace already shows "—" for a null IP. Its footnote will say IPs are recorded only behind the configured proxy.

### 2.5 Production proxy configuration (to document in `docs/DEPLOYMENT_PROXY.md`)

Examples only, since no deployment files exist and the host is not fixed:
- **Caddy** (the documented choice): `reverse_proxy` already ignores `X-Forwarded-For` from untrusted clients and sets it to the connecting address, unless `trusted_proxies` is configured. Set `trusted_proxies` only if a CDN or load balancer sits in front (then `TRUSTED_PROXY_COUNT` stays 1, because Caddy rewrites the chain to the real client).
- **nginx:** `proxy_set_header X-Forwarded-For $remote_addr;` (overwrite, **not** `$proxy_add_x_forwarded_for`) and `proxy_set_header X-Real-IP $remote_addr;`. Behind a CDN, use `set_real_ip_from <CDN ranges>` with `real_ip_header`.
- **The app port:** `next start -H 127.0.0.1` (or a Docker service with no `ports:` entry, reachable only on the internal network).
- **Optional:** the proxy adds `X-Proxy-Secret`, and `PROXY_SHARED_SECRET` is set to the same value.
- **Check after deploying:** `curl -H "X-Forwarded-For: 6.6.6.6"` to the public URL, sign in, and confirm the log shows your real IP, not 6.6.6.6.

### 2.6 Tests

- **Unit (`client-ip`):**
  - a trusted single proxy;
  - a 2-proxy chain;
  - spoofed left-hand entries are ignored;
  - too few entries → null;
  - production with no config → null;
  - development falls back to the local address;
  - missing headers;
  - invalid, port, bracket, mapped-IPv4 and oversized values;
  - `x-real-ip` mode;
  - secret missing, wrong and right;
  - user-agent cap.
- **Security / integration:**
  - six failed logins, each with a different spoofed `X-Forwarded-For` behind a trusted proxy, are rate-limited on the sixth;
  - with no proxy config in production, spoofed values never reach `signin_logs` or `sessions`;
  - a real login through `authenticate` stores the resolved IP.
- **Existing auth tests** must pass unchanged.

---

## 3. Plan — sign-in log retention

### 3.1 Settings (in `app_settings`; no migration)

| Key | Default when absent | Meaning |
|---|---|---|
| `security.signin_log_retention_months` | `12` | Logs older than this many calendar months may be deleted. Allowed 3–120 (decision **D3**). |
| `security.signin_log_cleanup_enabled` | **`false`** | Automatic deletion is **off** until the client confirms the policy (C2). |

Changes go through `updateSecuritySettings` (same pattern as the proposal settings). It is limited to super admin and admin (decision **D2**), validated, and writes an `app.setting` audit row for each change.

### 3.2 Cleanup

- **Shared logic:** `scripts/jobs/prune-signin-logs.mjs`, plain Node and `pg`, like `db-migrate.mjs`, so it runs on any host without a build step. It exports `pruneSigninLogs(client, { now })` for the tests and has a CLI entry point.
- **Steps:**
  1. Take a **Postgres advisory lock** (`pg_try_advisory_lock`). If another run holds it, exit with "skipped: already running".
  2. Read both settings.
  3. Work out the cutoff as `now() - interval 'N months'`, using the database clock.
  4. If disabled, **delete nothing** and only report how many rows *would* be eligible.
  5. If enabled, `DELETE FROM signin_logs WHERE at < cutoff` in batches of 5,000. It touches **only `signin_logs`**: never `audit_logs`, `sessions`, users or anything else.
  6. Log one structured JSON line (`job`, `enabled`, `retentionMonths`, `cutoff`, `eligible`, `deleted`, `durationMs`).
  7. When enabled, also write one `audit_logs` row: action `system.signin_log_retention`, no actor, with the same facts. Audit rows are never deleted.
- **Idempotent:** deleting by a cutoff gives the same result if it runs twice, and the second run deletes 0.
- **Scheduling:** there is no worker in the repo, so **the host runs it once a day**: `npm run job:prune-signin-logs`. Examples for cron, a systemd timer and a Docker Compose one-shot service go in `docs/DEPLOYMENT_PROXY.md` (the deployment doc). Nothing in the app schedules it, so nothing runs by surprise.
- **Dry run:** `npm run job:prune-signin-logs -- --dry-run` always reports without deleting.

### 3.3 Admin screen (decision D2)

- A small **"Sign-in log retention"** card for super admin and admin. Suggested location: a new admin-only `/dashboard/settings/security` page, linked from the user menu, not the sidebar.
- **Shows:** the retention months, whether automatic deletion is on, the cutoff date, how many logs are currently past it, and the last run (from the audit log).
- **Enabling deletion:** a confirmation dialog that names the period. The switch stays **off** in every environment we touch; the client turns it on after confirming C2.
- **My Workplace and Performance:** a footnote, "Sign-in history is kept for N months" (or "kept indefinitely" while deletion is off).

### 3.4 Tests

- **Integration:**
  - rows 13 months, 11 months and 1 day old:
    - while disabled, nothing is deleted and the eligible count is right;
    - once enabled, only the 13-month row is deleted;
  - `audit_logs`, `sessions`, `users` and other tables are unchanged;
  - a second run deletes 0;
  - two runs at once: one deletes, the other is skipped by the lock;
  - a boundary row exactly at the cutoff is kept;
  - an execution audit row is written when enabled.
- **Settings:**
  - validation (3–120, integers only);
  - only super admin and admin may change them, all other roles get 403;
  - every change is audited.
- **CLI:** a smoke test of `--dry-run`.

---

## 4. Plan — attendance separation

### 4.1 Wording and UI

| Where | Change |
|---|---|
| Performance header | "Agent KPIs and CRM sign-in activity for your scope (same metrics as team reports)." |
| Performance table title | "Performance & CRM sign-in activity" |
| Performance "Activity" glance and table columns | Keep "CRM sign-ins" / "CRM sign-outs". Add a tooltip and footnote: "Authentication activity only. CRM sign-ins are not attendance." |
| Sidebar description for Performance | "Agent KPIs and CRM sign-in activity for your scope." |
| My Workplace | The panel title becomes **"CRM Sign-in History"** with the subtitle **"Authentication activity"**. The tile stays "Sign-ins logged". The footnote adds "This is not an attendance record." |
| HR overview | Add a muted **"Attendance — not available"** card: "CRM sign-ins are not attendance. Attendance tracking waits on the client's requirements (Q-H2)." It is not a link. |
| CSV export | The headers stay "CRM sign-ins" / "CRM sign-outs" (already neutral). |

No metric is removed. Counts stay, labelled as authentication activity.

### 4.2 Guardrails

- A unit test fixes the Performance row and My Workplace sign-in row fields to their current keys, so no hours, duration, late, absent or present field can appear without a test failing.
- A test checks that the Performance and My Workplace page text contains no "attendance" except in the "not attendance" or "not available" notes.

### 4.3 Documentation

- `REQUIREMENTS.md` FR-143: mark "sign-in log based" as **superseded**: "CRM sign-ins are authentication activity, never attendance. Attendance rules pending client (Q-H2)."
- Correct the matching lines in `HR_MODULE_PLAN.md` (Q-H2 default, §3, §10), `PERFORMANCE_MODULE_PLAN.md`, `MODULES_AND_FEATURES.md` (note that the reference wording is intentionally not followed) and `ASSUMPTIONS_AND_OPEN_QUESTIONS.md` (Q-H2).

---

## 5. Decisions needed before implementation

**Client decisions** (they change behaviour or data):

| # | Question | Proposed handling until answered |
|---|---|---|
| C1 | Confirm that **CRM sign-ins are never attendance** (this changes FR-143 and departs from the reference wording "CRM attendance"), and what attendance should be, if anything (Q-H2). | Apply the wording changes in §4; show attendance as "not available". |
| C2 | Confirm **12 months** of sign-in log retention, and that old logs may then be **permanently deleted**. | Build everything with deletion **off** and 12 months shown as the proposed value. |
| C3 | Production network layout: Caddy only, or a CDN / load balancer in front? Can the app port be kept private? | Document both cases; ship with `TRUST_PROXY=false`, so production records no IP until the proxy is configured. |

**Your decisions** (implementation choices):

| # | Question | Recommendation |
|---|---|---|
| D1 | The IP fix changes the **input** to the login rate limiter (the key uses the corrected IP). The auth logic itself is unchanged, but this is the only auth-adjacent effect. Accept it? | **Yes.** Otherwise the rate limit stays bypassable. |
| D2 | Where admins change retention, and who may. | New admin-only `/dashboard/settings/security`, linked from the user menu; super admin and admin. |
| D3 | Minimum and maximum retention. | 3–120 months, so recent logs can't be wiped by mistake. |
| D4 | Production with no proxy configured: store no IP (fail closed) or keep today's spoofable value? | **Store none**, and warn in the server log. |

---

## 6. Sequence

| Step | Work | Needs |
|---|---|---|
| 0 | Answers to D1–D4; C1–C3 proposed defaults accepted | — |
| 1 | `client-ip.ts` + `requestMeta` wiring + unit and security tests; `.env.example`; `DEPLOYMENT_PROXY.md` | D1, D4 |
| 2 | Retention settings service + job script + `npm run job:prune-signin-logs` + tests | D3 |
| 3 | Security settings page and card (deletion off) | D2 |
| 4 | Attendance wording: Performance, navigation, My Workplace, HR overview; guard tests; docs | C1 default |
| 5 | Full regression, typecheck, lint, build, drift check (expect no schema change) | 1–4 |
| 6 | Browser: six roles on Performance, My Workplace, HR, and the settings page (admins only, others 403 / Access denied); 375 / 768 / 1440 | 5 |
| 7 | Implementation log here; update `SECURITY_AND_PRIVACY.md` (retention, IP), `SYSTEM_ARCHITECTURE.md` §6, and the docs in §4.3 | 6 |

**No migrations are planned.** The settings use the existing `app_settings` table and the job deletes by `at`. An index on `signin_logs(at)` is unnecessary at this volume. If it is ever needed, it would be an additive migration.

---

## 7. Implementation log (30–31 Oct 2026)

### 7.1 Secure IP logging (D1, D4)
| File | Change |
|---|---|
| `src/server/auth/client-ip.ts` (new) | `readProxyConfig(env)`, `resolveClientIp(headers, config)`, `normalizeIp`, `cleanUserAgent`. Pure functions with no Next.js imports. |
| `src/server/auth/current-user.ts` | `requestMeta()` uses the resolver and caps the user agent at 512 characters. It logs one `[client-ip]` warning in production when the IP cannot be trusted. **This is the only auth change.** Login, sessions, cookies, expiry and logout are untouched. |
| `src/server/auth/login.ts`, `rate-limit.ts` | **Unchanged.** The limiter key is still `email|ip`, but `ip` is now the verified IP or `unknown`, so rotating `X-Forwarded-For` no longer resets the limit. The limit (5 per 15 minutes) is not weakened. |
| `.env.example` | `TRUST_PROXY=false`, `TRUSTED_PROXY_COUNT=1`, `CLIENT_IP_HEADER` and `PROXY_SHARED_SECRET` (commented). |
| `docs/DEPLOYMENT_PROXY.md` (new) | Network rule, Caddy config, environment variables, spoofing check, development notes, cleanup scheduling (cron, systemd, Compose), how admins change retention. CDN settings are pending (C3). |

How the IP is chosen:
- **Trusted proxy** (`TRUST_PROXY=true`): the entry `TRUSTED_PROXY_COUNT` places from the right of `X-Forwarded-For`, or the single configured header. It must be a valid IP; headers over 1 KB are rejected; the optional shared secret is compared in constant time.
- **Production without that setting, or with invalid settings:** **no IP** is recorded.
- **Development:** only the loopback address Next.js fills in is accepted. A spoofed value, a chain of addresses, or `X-Real-IP` is ignored.

### 7.2 Sign-in log retention (D2, D3, C2)
| File | Change |
|---|---|
| `src/modules/security/retention.ts`, `policy.ts`, `service.ts` (new) | Settings in the existing `app_settings` table: `security.signin_log_retention_months` (default 12, allowed 3–120) and `security.signin_log_cleanup_enabled` (default **off**), plus `security.signin_log_cleanup_last_run` written by the job. Changes are limited to super admin and admin, need `confirmEnable: true` to switch deletion on, and are audited as `app.setting`. `signinRetentionNote` supplies the page footnotes. |
| `scripts/jobs/prune-signin-logs.mjs` (new), `npm run job:prune-signin-logs` | See below. |
| `src/app/(app)/dashboard/settings/security/` (new) + `src/features/security/` | The Security settings page: tiles, the retention form, the automatic-deletion card with a confirmation dialog, and the Client IP recording panel, which shows the proxy state and "Your IP on this request" and **never shows the secret**. A shield link in the header is shown to super admin and admin only. Everyone else gets Access denied. |

The cleanup job:
- uses an advisory lock, so two runs never overlap;
- reads the settings, and refuses to delete if the stored value is outside 3–120;
- takes the cutoff from the database clock;
- counts eligible rows;
- deletes in batches **only** when enabled and not `--dry-run`;
- deletes **only from `signin_logs`**;
- writes a one-line JSON log and the last-run setting, plus a `system.signin_log_retention` audit row when it deletes.

**No migration.** The drift check is clean and `schema.ts` is unchanged.

### 7.3 Attendance separation (C1)
- **Performance:**
  - Header: "Agent KPIs and CRM sign-in activity for your scope".
  - Table title: "Performance & CRM sign-in activity".
  - The sign-in glance caption says "not attendance", and the column tooltips say "authentication activity, not attendance".
  - New footnote: sign-ins are not attendance and are not used for hours, lateness or absences, plus the retention note.
- **Navigation:** the Performance description says "CRM sign-in activity".
- **My Workplace:**
  - The panel is **"CRM Sign-in History"** with the subtitle **"Authentication activity"**.
  - The tile caption says "not attendance".
  - The footnote says it is not an attendance record, explains where IPs come from, and gives the retention note.
- **HR overview:** a fourth card, **"Attendance — not available"**, marked "Pending client decision" (Q-H2). The grid is now 4 columns at extra-large widths.
- **Docs:**
  - FR-143 is marked superseded.
  - Q-H2 is reworded in `ASSUMPTIONS_AND_OPEN_QUESTIONS.md`, `HR_MODULE_PLAN.md` and `ADMIN_WALKTHROUGH_CHECKLIST.md` (C2 and C3 added there).
  - `PERFORMANCE_MODULE_PLAN.md`, `MODULES_AND_FEATURES.md` and `MY_WORKPLACE_MODULE_PLAN.md` are updated.
  - `SECURITY_AND_PRIVACY.md` (client IP, brute force, retention, separate audit logs, go-live checklist) and `SYSTEM_ARCHITECTURE.md` §6 are updated.

### 7.4 Tests
- **`tests/unit/client-ip.test.ts` (12):**
  - default and invalid configuration;
  - normalisation of ports, brackets, mapped IPv4, zone IDs and garbage;
  - one trusted proxy and a 2-proxy chain with spoofed left-hand entries;
  - too few entries;
  - `x-real-ip` mode;
  - missing, malformed and oversized headers;
  - shared secret missing, wrong and right;
  - production without a proxy records nothing, whatever is sent;
  - development accepts loopback only and rejects spoofing;
  - user-agent cap.
- **`tests/unit/security-rules.test.ts` (7):**
  - only super admin and admin may manage security;
  - the job and the app use the same keys and limits;
  - 3–120 validation, and unknown fields are rejected;
  - how the job parses the stored setting;
  - the job's only DELETE is on `signin_logs`, and it never touches `audit_logs`;
  - Performance, My Workplace and navigation text mention attendance only to deny it;
  - the Performance and Workplace services compute no duration, hours, lateness or absence fields.
- **`tests/integration/security.test.ts` (13):**
  - deletion off by default: nothing is deleted, the eligible count is reported, the last run is stored, and no execution audit row is written;
  - a dry run never deletes, even when enabled;
  - when enabled, only rows older than 12 months are deleted (in batches of 1); audit logs (including a 24-month-old one), sessions and users are untouched; one execution audit row is added;
  - idempotent, and keeps a row just inside a 3-month cutoff;
  - the lock is held → "skipped", then the next run succeeds;
  - an invalid stored value deletes nothing;
  - settings defaults;
  - role permissions (super admin and admin allowed; manager, agent, HR and accountant 403);
  - range validation and the confirmation required to enable;
  - audit rows per change; status cutoff and eligible count;
  - **security:** rotating spoofed `X-Forwarded-For` values behind the proxy still hits RATE_LIMITED on the 6th attempt; without a proxy, spoofed values are ignored and the limit still applies; a real login stores only the verified IP in `signin_logs` and `sessions`, and none without a proxy.
- **Full regression:** 29 files, **287 / 287 pass** (255 before + 32 new). Typecheck, lint and the production build are clean; the drift check is clean.

### 7.5 Manual checks (dev server, real `/login` form, verify.* accounts)
| Role | Security settings | Header shield link | Performance | My Workplace | HR attendance card | New sign-in IP |
|---|---|---|---|---|---|---|
| Super admin | Allowed | Shown | New wording, no "attendance" | "CRM Sign-in History" / "Authentication activity" / "not an attendance record" | Shown | `::1` |
| Admin | Allowed | Shown | Same | Same | Shown | `::1` |
| Manager | Access denied | Hidden | Same | Same | Shown | `::1` |
| Agent | Access denied | Hidden | Same (own row) | Same | Shown | `::1` |
| HR | Access denied | Hidden | Access denied (unchanged) | Same | Shown | `::1` |
| Accountant | Access denied | Hidden | Access denied (unchanged) | Same | Shown | `::1` |

- **Security settings UI:**
  - Entering 2 months shows "Keep at least 3 months" and nothing is saved.
  - "Turn on automatic deletion…" opens the confirmation dialog (centred). It was **cancelled**, and deletion stays **off**.
- **Cleanup job on the dev database:**
  - `--dry-run` → `dry_run`, 0 eligible, 0 deleted.
  - A normal run → `disabled`, 0 deleted.
  - The page then showed "Checked only · Deletion off".
- **Data preserved:**
  - Before: signin_logs 122, audit_logs 99, users 11, leads 5.
  - After: signin_logs 134 (only the new role sign-ins), audit_logs 99, users 11, leads 5.
  - `app_settings` went from 3 to 4 (the job's last-run entry only). No retention setting was stored.
- **Layouts:** Security settings at 1440, 768 and 375 by screenshot; HR and Performance at 1440 by screenshot; My Workplace, Performance and HR measured at 375 and 768. No horizontal page overflow anywhere. The last-run tile was shortened ("Checked only" plus "Deletion off · date") after it was cut off at 375.
- **Server log:** no errors. The dev server was restarted after the production build to avoid the stale-module issue seen in the My Workplace milestone.

### 7.6 Remaining items
- **Client:**
  - C2: confirm 12 months, then a super admin or admin switches automatic deletion on.
  - C3: CDN or load balancer in front of Caddy?
  - Q-H2: does the client need attendance, and how?
- **Deployment (not in the repo):** keep the app port private, set `TRUST_PROXY=true`, run the spoofing check in `DEPLOYMENT_PROXY.md` §5, and schedule the daily job.
- **Development:** the dev server has no proxy, so only `::1` is recorded. Real client IPs can only be verified on the deployed server.
- **Existing rows:** sign-in rows stored before this change keep their original IP values. They were recorded the old way, so in production data they may include spoofed values.

---

## 8. Final verification pass (31 Oct 2026)

### 8.1 Build and checks (after the Security settings mobile tile fix)
| Check | Result |
|---|---|
| Production build (`npm run build`, dev server stopped first) | **Pass**. `/dashboard/settings/security`, `/dashboard/workspace`, `/dashboard/performance` and `/dashboard/hr` all built. |
| Full regression (`vitest run`) | **29 files, 287 / 287 pass** |
| Typecheck | **Pass** |
| Lint | **Pass** (0 problems) |
| Schema drift | `drizzle-kit check`: "Everything's fine". `drizzle-kit generate`: "No schema changes, nothing to migrate" (no file created). **No migration in this milestone.** |

### 8.2 Retention cleanup and the deletion switch
- `npm run job:prune-signin-logs -- --dry-run` on the dev database → `status: dry_run`, `enabled: false`, `retentionMonths: 12`, `eligible: 0`, `deleted: 0`.
- Table counts were identical before and after: signin_logs 134, audit_logs 99, users 11, sessions 24, leads 5, holidays 0, employee_profiles 1, app_settings 4.
- **Automatic deletion is disabled.** `security.signin_log_cleanup_enabled` and `security.signin_log_retention_months` are **not stored**, so the defaults apply (off, 12 months proposed). The Security settings page shows "Off — nothing is deleted".
- A dry run still updates `security.signin_log_cleanup_last_run` (now `dry_run`). This is intended: it lets admins see that the scheduled job runs. The deployment guide now says so.

### 8.3 Deployment guide review (`DEPLOYMENT_PROXY.md`)
Issues found and **fixed (documentation only, no code change)**:
1. **The cron and systemd examples would have failed:** the job reads only `.env.local` or the process environment, and the cron example loaded no env, so the job would exit with "DATABASE_URL is not set". The cron line now sources `.env`, the doc explains the requirement, and the systemd and Compose notes say where `DATABASE_URL` comes from.
2. **The spoofing check was ineffective:** `curl … /login` signed nobody in. It is replaced by a browser header-extension test against "Your IP on this request" and the CRM Sign-in History.
3. **Port privacy was incomplete.** Added:
   - a Compose example with no `ports:` on the app;
   - a warning not to use `-H 127.0.0.1` inside a container;
   - firewall rules, including that Docker-published ports bypass ufw;
   - an outside reachability check (`curl -m 5 http://<server-ip>:3000/login` must fail).
4. **Caddy requirements are now stated:** version **2.5 or later** (from that version it replaces client-sent `X-Forwarded-For` unless `trusted_proxies` is set). The shared secret must be in both Caddy's and the app's environment.
5. **Added §7a**, a production checklist summary, and the steps to enable the systemd timer and do a first manual dry run.

**Confirmed requirements:**
- **App port:** reachable only from Caddy (loopback bind on a plain host; no `ports:` and the internal network under Compose; firewall allows only 22, 80, 443).
- **Proxy settings:** `TRUST_PROXY=true`, `TRUSTED_PROXY_COUNT=1`, `CLIENT_IP_HEADER` unset, `PROXY_SHARED_SECRET` optional, and `trusted_proxies` **not** set in Caddy. CDN or load balancer settings wait on C3.

### 8.4 Six roles (real `/login` form, fresh dev server)
| Role | `/api/v1/employees` | `/api/v1/holidays` | `/api/v1/me/workplace` | `…/me/workplace?userId=…` | `/api/v1/performance` | Security settings |
|---|---|---|---|---|---|---|
| Super admin | 200 | 200 | 200 | 400 | 200 | Allowed |
| Admin | 200 | 200 | 200 | 400 | 200 | Allowed |
| Manager | 200 (read-only) | 200 | 200 | 400 | 200 | Access denied |
| Agent | 403 | 403 | 200 | 400 | 200 (own) | Access denied |
| HR | 200 | 200 | 200 | 400 | 403 | Access denied |
| Accountant | 403 | 403 | 200 | 400 | 403 | Access denied |

Every result matches the documented permissions (`HR_MODULE_PLAN.md` §5, `MY_WORKPLACE_MODULE_PLAN.md` §4, `PERFORMANCE_MODULE_PLAN.md`, D2). The dev server log has no errors.

### 8.5 Test data and unintended changes
- **No test holidays remain** (0). The holiday create / delete audit entries from earlier checks stay; audit logs are append-only by design.
- **Retention settings:** nothing stored except the job's last-run record (see 8.2). The invalid "2 months" attempt in the UI was rejected and saved nothing; the enable-deletion dialog was cancelled.
- **Left over from earlier milestones:**
  - The **empty `employee_profiles` row** for `verify.agent@mz.local` (all fields null) was **deleted on your approval (31 Oct 2026, see 8.8)**. Its 4 audit entries and the user account are kept.
  - **Sign-in log rows** from the verification sign-ins (all `::1`) are kept. They are genuine authentication events, as the retention rules require.
- **No temporary scripts remain** (`scripts/` holds only `db-migrate.mjs`, `db-seed.mjs` and `jobs/`). The changes contain **no credentials**: the verification password was searched for and not found. `.env.local` and `.dev-credentials` are git-ignored. The only `console.log` is the cleanup job's intended JSON output.

### 8.6 Git state (nothing committed or pushed)
These uncommitted changes cover **two milestones**: My Workplace and Production Readiness. Holidays and Employee Records were committed in `7121251`.

**Modified (17):**
- `.env.example`, `package.json`
- `docs/`: `ADMIN_WALKTHROUGH_CHECKLIST.md`, `ASSUMPTIONS_AND_OPEN_QUESTIONS.md`, `HR_MODULE_PLAN.md`, `MODULES_AND_FEATURES.md`, `PERFORMANCE_MODULE_PLAN.md`, `REQUIREMENTS.md`, `SECURITY_AND_PRIVACY.md`, `SYSTEM_ARCHITECTURE.md`
- `src/app/(app)/dashboard/`: `hr/page.tsx`, `performance/page.tsx`, `workspace/page.tsx`
- `src/components/shell/header.tsx`, `src/config/navigation.ts`, `src/modules/holidays/service.ts`, `src/server/auth/current-user.ts`

**Untracked (22):**
- `docs/`: `DEPLOYMENT_PROXY.md`, `MY_WORKPLACE_MODULE_PLAN.md`, `PRODUCTION_READINESS_PLAN.md`
- `scripts/jobs/prune-signin-logs.mjs`
- `src/app/(app)/dashboard/settings/security/`: `page.tsx`, `loading.tsx`
- `src/app/(app)/dashboard/workspace/loading.tsx`, `src/app/api/v1/me/workplace/route.ts`
- `src/features/security/`: `actions.ts`, `components/retention-form.tsx`
- `src/modules/security/`: `policy.ts`, `retention.ts`, `service.ts`
- `src/modules/workplace/`: `service.ts`, `user-agent.ts`, `validation.ts`
- `src/server/auth/client-ip.ts`
- `tests/integration/`: `security.test.ts`, `workplace.test.ts`
- `tests/unit/`: `client-ip.test.ts`, `security-rules.test.ts`, `workplace-rules.test.ts`

Git warns that line endings will be converted from LF to CRLF on the next checkout; the content is unaffected.

### 8.7 Remaining deployment tasks
1. Set up production as in `DEPLOYMENT_PROXY.md` §7a: env file (`NODE_ENV`, `DATABASE_URL`, `TRUST_PROXY=true`, `TRUSTED_PROXY_COUNT=1`), build, migrate, start the app privately, Caddy 2.5+ in front, firewall.
2. Run the §5 verification on the live server (real IP shown; a spoofed header ignored; app port unreachable; no `[client-ip]` warning).
3. Schedule the daily `job:prune-signin-logs` and do one manual dry run.
4. **Client decisions:** C2 (confirm 12 months, then an admin turns on automatic deletion), C3 (CDN or load balancer?), Q-H2 (attendance requirements).
5. ~~Optional clean-up: remove the empty Verify Agent `employee_profiles` row.~~ Done (8.8).

### 8.8 Test data clean-up (31 Oct 2026, on your approval)
- **Deleted:** one `employee_profiles` row, id `0fea3a33-719f-4a72-a224-c87769289217`, for Verify Agent (`verify.agent@mz.local`).
  - Before deleting, it was confirmed as the only profile for that account, with every HR field null.
  - The `DELETE` ran in a transaction matched on id, user and all-null fields, and would have rolled back unless exactly one row was removed.
  - No other table references `employee_profiles`.
- **Kept:**
  - The user account: active, role agent, unchanged.
  - The **4 `employee_profile` audit entries**. The employee page's Profile history still shows them; the profile card is simply empty again, as for any account without a profile.
- **Verified:** row counts of **every table** before and after. Only `employee_profiles` changed (1 → 0); all other tables, including users, audit_logs and signin_logs, are identical. A re-check found no profile left for the account.
- The temporary script was removed. No code changed, and nothing was committed.
