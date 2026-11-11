# Production reverse proxy, client IP and scheduled cleanup

The steps the server administrator must take so the CRM records correct client IP addresses, and so the sign-in history cleanup runs. Background: `PRODUCTION_READINESS_PLAN.md`.

The repository contains no deployment files and assumes no hosting provider. The planned setup (`SYSTEM_ARCHITECTURE.md`) is one server running the Next.js app behind **Caddy**. **CDN or load balancer settings are pending client confirmation (C3)**; they are not covered here yet.

---

## 1. Why this is needed

- The CRM records the client IP for each sign-in and sign-out, for sessions, and for the login rate limit (5 failed attempts per 15 minutes per email and IP).
- Next.js cannot tell a header sent by a browser from one set by a proxy. So the app **never trusts forwarded headers unless the server is configured to say a trusted proxy overwrites them**.
- With no configuration, production records **no IP** (shown as "—"), and the login rate limit then applies per email. Nothing a browser sends is ever stored as an IP.

## 2. Network rule (required)

The Node.js server must be reachable **only from the reverse proxy**, never directly from the internet:

- **Same host (no containers):** start the app on the loopback interface: `npm run start -- -H 127.0.0.1 -p 3000`.
- **Docker Compose:** give the app service **no `ports:` entry**; Caddy reaches it on the internal network (for example `app:3000`), and only the Caddy service publishes 80 and 443. Inside the container the app must listen on all interfaces (the default), so **do not** pass `-H 127.0.0.1` there.

  ```yaml
  services:
    app:
      # no "ports:" here
      env_file: .env
      environment:
        NODE_ENV: production
    caddy:
      image: caddy:2   # 2.5 or later
      ports: ["80:80", "443:443"]
      env_file: .env   # only needed for PROXY_SHARED_SECRET
      volumes: ["./Caddyfile:/etc/caddy/Caddyfile:ro", "caddy_data:/data"]
  volumes:
    caddy_data:
  ```
- **Firewall:** allow only 22 (SSH), 80 and 443 from the internet (for example `ufw default deny incoming`, then `ufw allow 22,80,443/tcp`). Note that Docker-published ports bypass ufw, which is another reason the app service must have no `ports:` entry.
- **Check from another machine:** `curl -m 5 http://<server-public-ip>:3000/login` must fail to connect.

## 3. Caddy

Use **Caddy 2.5 or later**. Its `reverse_proxy` **replaces** any incoming `X-Forwarded-For` with the address of the connection it received. It only keeps client-sent values when `trusted_proxies` is configured, so **do not set `trusted_proxies`** while Caddy is the first hop. TLS certificates and HTTPS redirects are automatic.

```caddyfile
crm.example.com {
    encode zstd gzip

    reverse_proxy 127.0.0.1:3000 {
        # Optional extra check (see §4). Remove this line if PROXY_SHARED_SECRET is not used.
        header_up X-Proxy-Secret {env.PROXY_SHARED_SECRET}
    }
}
```

In Docker Compose, use `reverse_proxy app:3000` instead of `127.0.0.1:3000`. If the shared secret is used, the **same value** must be in Caddy's environment and the app's environment.

## 4. App environment variables

| Variable | Value with Caddy | Notes |
|---|---|---|
| `TRUST_PROXY` | `true` | Default `false`. Without it, production records no IP. |
| `TRUSTED_PROXY_COUNT` | `1` | One trusted proxy (Caddy). The client is taken this many entries from the right of `X-Forwarded-For`, so entries a browser adds on the left are ignored. Allowed 1–10. |
| `CLIENT_IP_HEADER` | *(leave unset)* | Defaults to `x-forwarded-for`. Set to a header such as `x-real-ip` only if the proxy overwrites that header instead. |
| `PROXY_SHARED_SECRET` | *(optional)* | When set, forwarded headers are trusted only if the request carries `X-Proxy-Secret` with the same value. It protects against the app port being exposed by mistake. Use a long random value and keep it only on the server. |

If any value is invalid (for example `TRUST_PROXY=yes`), the app records no IP and logs a warning once. The **Security settings** page (super admin and admin; shield icon in the header) shows the current state and the IP recorded for your own request.

## 5. Verify after deploying

1. Sign in as a super admin or admin and open **Security settings → Client IP recording**. It should show "Trusted proxy: Enabled", and "Your IP on this request" should be your public IP (compare with any "what is my IP" site).
2. Try to spoof it: install a browser extension that adds request headers (for example ModHeader), add `X-Forwarded-For: 6.6.6.6`, and reload Security settings. "Your IP on this request" must **still** show your real IP. Sign out and in again with the header active: **My Workplace → CRM Sign-in History** must show your real IP, never `6.6.6.6`. Remove the header afterwards.
3. Check that the app port is not reachable from outside (§2).
4. Check the server log has no `[client-ip] Not recording client IP addresses` warning.

## 6. Development

No configuration is needed. Without `TRUST_PROXY`, only the local loopback address that Next.js fills in (`::1` / `127.0.0.1`) is recorded; any other forwarded value is ignored.

---

## 7. Sign-in history cleanup (scheduled job)

Retention is set on **Security settings** (super admin, admin): 3–120 months, with 12 proposed. **Automatic deletion is off** until the client approves the policy (C2).

The job only ever deletes from `signin_logs`, and only when automatic deletion is on. It never touches audit logs, sessions, users or other records. Each run:
- takes a database lock, so two runs never overlap;
- uses the database clock;
- is safe to repeat;
- prints one JSON line;
- saves its result for the Security settings page;
- adds an audit entry (`system.signin_log_retention`) when it deletes.

```bash
npm run job:prune-signin-logs              # deletes only if automatic deletion is on
npm run job:prune-signin-logs -- --dry-run # never deletes; reports what is eligible
```

It needs `DATABASE_URL` **in the process environment**. The job reads `.env.local` if one exists, but not `.env` or `.env.production`, so the scheduler must load the production env file itself (as the examples below do). Without it the job exits with `DATABASE_URL is not set` and a non-zero code. Run it **once a day** with whatever scheduler the server uses.

**cron** (as the app user; the env file is loaded first, and the log directory must exist and be writable):
```cron
15 3 * * * cd /srv/mz-crm && set -a && . ./.env && set +a && /usr/bin/npm run job:prune-signin-logs >> /var/log/mz-crm/prune-signin-logs.log 2>&1
```

**systemd timer:**
```ini
# /etc/systemd/system/mz-crm-prune.service
[Service]
Type=oneshot
WorkingDirectory=/srv/mz-crm
EnvironmentFile=/srv/mz-crm/.env
ExecStart=/usr/bin/npm run job:prune-signin-logs

# /etc/systemd/system/mz-crm-prune.timer
[Timer]
OnCalendar=*-*-* 03:15
Persistent=true
[Install]
WantedBy=timers.target
```
Enable it with `systemctl daemon-reload && systemctl enable --now mz-crm-prune.timer`, and check with `systemctl list-timers mz-crm-prune.timer`. `EnvironmentFile` supplies `DATABASE_URL`; the file must use plain `KEY=value` lines.

**Docker Compose:** run the same command as a one-shot container, triggered by the host's cron or timer: `docker compose run --rm app npm run job:prune-signin-logs`. The app service's `env_file` supplies `DATABASE_URL`.

**First run:** after scheduling, run `npm run job:prune-signin-logs -- --dry-run` once by hand (with the env loaded). Security settings → "Last cleanup run" should then show "Dry run". A dry run deletes nothing; it only updates that last-run record.

## 7b. Unit-hold release (scheduled job, FR-081)

Client rule (10 Nov 2026): a token / unit hold expires after 7 days and the unit returns to Available. A new booking's **Reserved until** defaults to 7 days after creation (`HOLD_DAYS` in `src/modules/bookings/constants.ts`); the creator may still pick another date, and managers / admins may change it on the booking page.

A hold is **released** when all of these are true:
- the booking is still in **Negotiation** or **Token pending** (Token received and later stages mean the token is in);
- its Reserved-until date is before today (business time zone, Asia/Karachi), so a hold "until 18 Nov" is released during 19 Nov;
- **no payment has ever been recorded** on it (any payment row, even one later reversed).

Releasing cancels the booking with the reason **"Hold expired"**, returns the unit from Reserved to Available, and writes a stage-history entry and audit rows (`booking.cancel` with `source: hold_expiry`, and `unit.status`) with no user and no IP. The lead stays where it is, as with a manual cancel. Each booking is released in its own transaction with the booking row locked first, the same lock a payment takes, and the rule is checked again under the lock, so a payment recorded at the same moment wins. Runs are safe to repeat or overlap. Bookings created before the 7-day default with no Reserved-until date are never released automatically. Until the job runs, the Bookings list and booking page show **"Hold expired · releasing"**; an overdue hold that has a payment shows **"Hold overdue"** and is left alone.

```bash
npm run job:release-holds              # cancels expired, unpaid holds and frees their units
npm run job:release-holds -- --dry-run # changes nothing; lists the bookings that would be released
```

It prints one JSON line (`eligible`, `released`, `skipped`, `failed` and each booking). The exit code is non-zero when a booking failed to release or the database is unreachable. It needs `DATABASE_URL` in the process environment, exactly as in §7, and Node 22.18 or later (it loads the app's TypeScript module with Node's built-in type stripping; no build is needed). Run it **every hour**.

**systemd timer:**
```ini
# /etc/systemd/system/mz-crm-release-holds.service
[Unit]
Description=MZ CRM: release expired unit holds (FR-081)
After=network-online.target postgresql.service
[Service]
Type=oneshot
User=mzcrm
WorkingDirectory=/srv/mz-crm
EnvironmentFile=/srv/mz-crm/.env
ExecStart=/usr/bin/npm run job:release-holds

# /etc/systemd/system/mz-crm-release-holds.timer
[Unit]
Description=Hourly MZ CRM unit-hold release
[Timer]
OnCalendar=hourly
RandomizedDelaySec=2m
Persistent=true
[Install]
WantedBy=timers.target
```
Enable it with `systemctl daemon-reload && systemctl enable --now mz-crm-release-holds.timer`, and check with `systemctl list-timers mz-crm-release-holds.timer` and `journalctl -u mz-crm-release-holds.service`.

**cron** (as the app user): `5 * * * * cd /srv/mz-crm && set -a && . ./.env && set +a && /usr/bin/npm run job:release-holds >> /var/log/mz-crm/release-holds.log 2>&1`

**Docker Compose:** `docker compose run --rm app npm run job:release-holds`, triggered hourly by the host.

**First run:** after deploying, run `npm run job:release-holds -- --dry-run` once by hand (with the env loaded) and check the listed bookings before enabling the timer.

## 7a. Production checklist (summary)

1. `NODE_ENV=production`, `DATABASE_URL`, `TRUST_PROXY=true`, `TRUSTED_PROXY_COUNT=1` (plus `PROXY_SHARED_SECRET` if used) in the app's env file.
2. `npm ci && npm run build && npm run db:migrate` (with the env loaded), then start the app privately (§2).
3. Caddy 2.5+ in front with the config in §3; firewall as in §2.
4. Verification steps in §5 pass.
5. Daily cleanup scheduled (§7) and one manual dry run done. Hourly hold release scheduled (§7b) after one manual dry run.
6. Retention period confirmed by the client before anyone turns automatic deletion on (§8). CDN or load balancer settings wait on C3.

The exit code is non-zero only on errors (for example the database is unreachable). "Skipped" (another run in progress) and "disabled" are normal results.

## 8. Changing the retention policy (administrators)

1. Sign in as a super admin or admin and open **Security settings** (shield icon in the header).
2. **Retention period:** enter 3–120 months and save. This takes effect at the next job run.
3. **Automatic deletion:** "Turn on automatic deletion…" asks for confirmation. Turn it on only after the client has approved the policy. "Turn off" stops further deletions immediately; entries already deleted cannot be restored except from a database backup.
4. Every change is recorded in the audit log (`app.setting`).

---

## 9. Call recording storage (added 31 Oct 2026)

Uploaded call recordings (`LEADS_MODULE_PLAN.md` §10) are stored as private files on the server, outside `public/`, and only served through the authenticated `/api/v1/recordings/:id` route.

| Setting | Production value | Notes |
|---|---|---|
| `FILE_STORAGE_DIR` | An absolute path on a **persistent volume**, for example `/srv/mz-crm-data/storage` | Default is `./storage` in the app folder. In Docker it must be a named volume or bind mount, or files are lost when the container is replaced. The app user needs read and write access; files are created with mode 600. |

**Backups:** recordings are **not** in the database, so the nightly `pg_dump` (`SECURITY_AND_PRIVACY.md` §9) does not include them. Back up `FILE_STORAGE_DIR` on the same schedule and restore both together. A `files` row whose file is missing returns "Recording file not found".

**Upload size at the proxy:** recordings can be 25 MB.
- **Caddy:** no request body limit by default, so nothing to change.
- **nginx** (if used instead): `client_max_body_size 26m;` (nginx's default of 1 MB would reject uploads).

**S3-compatible storage** (planned in `SYSTEM_ARCHITECTURE.md`) is not implemented. It needs the client's provider choice and credentials. Moving from local storage later means copying the folder and switching the storage driver.

---

## 10. Same-origin check for API requests (fixed 31 Oct 2026)

State-changing API requests (`POST` / `PATCH` / `DELETE` under `/api/v1`) must carry an `Origin` that matches the site, as CSRF protection alongside `SameSite=Lax` cookies.

**Bug found by the Playwright suite.**
- The check compared `Origin` with `req.nextUrl.origin`, which Next.js builds from the hostname it was *started* with (`localhost` by default), not from the address the browser used.
- Under `next start --hostname 127.0.0.1`, and behind Caddy (`https://crm.example.com` vs `http://localhost:3000`), every browser `fetch` POST was refused with 403 "Cross-origin request blocked.". That covered recording and document uploads and notification mark-read.
- Server actions (forms) were not affected; they use Next.js's own origin check.

**Fix (`src/server/origin.ts`).** The Origin's host must equal the host the browser addressed:
- the `Host` header, which a web page cannot set; or
- with `TRUST_PROXY=true` (and the shared secret, if configured), `X-Forwarded-Host`. In that case `X-Forwarded-Proto` must also match the Origin's scheme.

`null`, malformed and non-http(s) origins are refused, and requests without `Origin` (non-browser clients, which carry no ambient cookies) are allowed, as before. Unit tests are in `tests/unit/origin.test.ts`.

**What the proxy must do.**
- Caddy's `reverse_proxy` passes the original `Host` through and sets `X-Forwarded-Host` / `X-Forwarded-Proto` by default, so §3 needs no change.
- With nginx, add `proxy_set_header Host $host;` and `proxy_set_header X-Forwarded-Proto $scheme;`.
- Do not rewrite `Host` to the upstream address.

---

## 11. Security headers (added 31 Oct 2026)

The app sets its own security headers in `next.config.ts` (`headers()`), so they apply behind any proxy and in every environment. They implement `SECURITY_AND_PRIVACY.md` §7.

| Header | Value | Where |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` | Every path except `/api/` |
| `X-Frame-Options` | `DENY` | Every path |
| `Referrer-Policy` | `same-origin` | Every path |
| `X-Content-Type-Options` | `nosniff` | Every path |
| `Strict-Transport-Security` | `max-age=31536000` (one year) | Every path; browsers only honour it over HTTPS |

**Why the policy looks like this.**
- **`'unsafe-inline'` scripts.**
  - Next.js streams its page data as inline scripts. The alternative, a per-request nonce, requires every page to render dynamically.
  - The Next.js 16 CSP guide says nonces are incompatible with Partial Prerendering, which this app uses (`cacheComponents`).
  - The policy therefore follows the guide's "Without Nonces" pattern.
  - Scripts still load only from the app's own origin; no third-party scripts are allowed.
- **`'unsafe-eval'` is added in development only** (`next dev`), because React needs it for error stacks. Production builds never send it; the Playwright suite checks this.
- **`blob:` media** lets the recording panel read a chosen file's duration before upload.
- **No `upgrade-insecure-requests`:** Caddy already redirects HTTP to HTTPS. The directive would break plain-HTTP local runs (`next start` on 127.0.0.1).
- **`/api/` gets no app CSP.**
  - Config headers *replace* a header that a route sets itself.
  - The recording and document routes send a stricter policy that must reach the browser: `default-src 'none'; img-src 'self'; sandbox`.
  - JSON responses don't need a script policy. The other four headers still apply to `/api/`.
- **HSTS without `includeSubDomains` or `preload`:** those options bind every subdomain of the client's domain to HTTPS, possibly permanently. Add them only with the client's agreement once all their subdomains serve HTTPS.

**Proxy configuration.**
- **No change is needed in Caddy (§3).** Do not repeat these headers in the Caddyfile: a second `Content-Security-Policy` header would be combined with the app's, which is stricter than intended and hard to debug.
- If a header must be overridden at the proxy, use Caddy's `header` directive with replace semantics (for example `header Strict-Transport-Security "max-age=31536000; includeSubDomains"`), and document it here.
- With nginx, use the same rule: don't add duplicates with `add_header`.

**Checking after deployment.**

```bash
curl -sI https://crm.example.com/login
```

The response should show all five headers. Also confirm in the browser console that no CSP violations appear while signed in, uploading a recording and playing it.

**Tests:** `e2e/security-headers.spec.ts` (5 tests) checks:
- the headers on pages, API routes and static assets;
- that the file routes keep their sandbox policy;
- that a page on another origin cannot frame the app;
- that signed-in pages, `blob:` media and the notification dropdown raise no CSP violations, on desktop and mobile.
