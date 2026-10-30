# Project status and completion checklist

Updated **31 Oct 2026 (round 4: Playwright)**. Everything below was checked against the code and by running the checks named here. Nothing since commit `0f24ba9` (rounds 1–4) has been committed or deployed.

---

## 1. Completed features (verified)

| Area | What works | Plan / notes |
|---|---|---|
| Auth and security | Login / logout, sessions, login rate limit on the verified IP only, sign-in history, Security settings (retention **off**), trusted-proxy IP handling | `PRODUCTION_READINESS_PLAN.md` |
| Dashboard | KPIs, date ranges (24h / 7d / 30d / MTD / 6m / custom), team filter, sources, channels, pipeline-health tiles, recent leads, top projects, **lost leads by reason and by team**. Aging matrix blocked (§4). | `DASHBOARD_PLAN.md` |
| Leads | List and views, pipeline with **drag-and-drop** (mouse, touch, pen) and the menu, detail, timeline, notes, follow-ups, To-dos, duplicates, regenerated, shared phones (view), lost approvals, reviews, **click-to-call**, **call recordings**, **documents** | `LEADS_MODULE_PLAN.md` §10–12 |
| Notifications | Bell with unread count, follow-up pop-up, history page, mark read / all, reminder window (off until set) | `NOTIFICATIONS_PLAN.md` |
| Clients | List (with the investment filter and latest-investment column), detail, convert, follow-ups, investments, payment history | `CLIENTS_MODULE_PLAN.md` |
| Projects, Inventory, Bookings, Tasks / proposals, Meetings, Teams, Targets, Performance | Built (bookings on proposed defaults; call metrics "not available") | Plans |
| Accounts & Finance | F1 payments, F2 screens, **F4 reports: collections by project, outstanding by project / agent, audited CSV** | `FINANCE_MODULE_PLAN.md` §11 |
| HR, My Workplace | Employees, holidays, upcoming holidays, CRM sign-in history; leave pending; attendance "not available" | `HR_MODULE_PLAN.md`, `MY_WORKPLACE_MODULE_PLAN.md` |
| File storage | Private storage, content checks, size limits, access through lead permissions, byte ranges; reviewed and hardened in round 3 | `FILE_STORAGE_REVIEW.md` |

## 2. Verified tests and checks (final run, round 4)

| Check | Result |
|---|---|
| Test suite (Vitest) | **38 files, 342 / 342 passing** (adds `tests/unit/origin.test.ts`, 7 tests) |
| **Playwright suite** (`npm run test:e2e`, test database only) | **42 / 42 passing** in 1.9 min. 7 spec files: 33 desktop (1440 × 900) and 9 mobile (375 × 812, Pixel 7 touch emulation) tests; 0 skipped, 0 retries, 0 flaky. See §8 |
| End-to-end workflows (`tests/integration/workflows.test.ts`, test database) | 3 chained workflows pass: (1) **sales** — assignment notification, reminder, stage change with audit, recording and document upload / playback / range / permissions, re-inquiry, lost request and rejection notifications, read state; (2) **dashboard** KPI and lost counts reconcile with the leads lists for six scopes; (3) **finance** — payments, reversal, booking Paid, collections, outstanding and CSV audit all agree |
| Typecheck, lint | Pass |
| Schema drift | `drizzle-kit check` clean; `generate`: "No schema changes" |
| Production build | Pass (`next build`, 91 / 91 static pages), **0 warnings** |
| Six roles (browser, test database) | 25 routes and 4 APIs per role. No error pages; every refusal matches the documented permissions |
| Responsive (browser) | 28 routes at **375, 768 and 1440 px**: no horizontal page overflow |
| Security probes | Unauthenticated: every file, notification and report route returns 401; a cross-origin upload returns 403; a traversal-style id returns 404 with a session; a recording id sent to the documents route returns 404; an out-of-scope 20 MB upload returns 404 in 131 ms without the body being processed |
| Pipeline (browser) | Mouse drag moved a card; touch drag moved a card; pen drag onto Booked was refused; the timeline shows "new_lead → contacted by Agent A" |
| Data safety | All round-2 and round-3 browser QA used the **test** database. Dev-database row counts are unchanged apart from migration 0012's new empty table (checked by a full table count) |

**Not covered:**
- **Real devices:** Android phones (dialer hand-off and recorder files) and iOS Safari audio.
- **Browsers:** Playwright runs only the installed Google Chrome (`channel: "chrome"`). Firefox, Safari / WebKit and real phones are not automated.
- **Hidden-pane limits:** the browser pane was in the background, so:
  - a recording uploaded there had no duration (the browser didn't load the audio metadata in time; the field stays empty by design);
  - the aging-matrix explanation card wasn't checked by screenshot (the accountant's empty dashboard was).

## 3. Outstanding independent work

| Item | Note |
|---|---|
| *(none)* | The Playwright suite is done (§8). No other independent work has confirmed requirements; everything else waits on the client (§4) |

## 4. Client-dependent decisions

| Item | Question(s) | Current handling |
|---|---|---|
| Dashboard aging × meetings matrix (FR-014) | M-Q1 to M-Q5 (`DASHBOARD_PLAN.md` §7): engaged-pipeline definition, meeting counting, window, month length, avg / owner | Card explains it is waiting; the tiles are live |
| Dashboard definitions | Conversion, attrition and stale formulas (§3); D1 owner in several teams; D2 lost date | Implemented as documented proposals |
| Notifications | N1 reminder window, N2 lost request with no team manager, N3 notify on approval, N4 other events, N5 expiry, N6 email / push | Reminders off; documented events only |
| Recordings and documents | Delete / replace, retention, AMR / 3GP recordings, HEIC images, Office previews, whether a recording counts as a call | Upload and read only |
| Shared-phone merge (FR-032) | Six rule questions (`LEADS_MODULE_PLAN.md` §13) | Not built |
| Leave, My leave | Q3, Q3b, Q5, Q6 (+ Q4, Q8, Q14, Q15) | Not built |
| Employee accounts | Q1, Q2, Q16 | Read-only |
| Attendance | Q-H2 | "Not available" |
| Regional holidays | Q9 | All shown, labelled |
| Sign-in log deletion | C2 | Built, **off** |
| CDN / load balancer | C3 | Caddy only documented |
| Bookings | Q-B1 to Q-B6 (holds, stage gates, SPU, receipts, schedules) | Proposed defaults |
| Finance | Q-F3, Q-F4, Q-F8, Q-F9, Q-F10, Q-F13, Q-F15, Q-F16 (receipts, income / expense, refunds, backdating, KPIs) | F3 / F5 not built |
| Imports, email, 2FA, lead delete, roster ↔ rotation, critical flag | Q-P5, Q-T2, Q-R5, Q-L7, Q-L2, Q-L8 | Not built |

Out of scope (separate quote): AI call analysis, Meta / TikTok / WhatsApp, payroll / tax / ledger, HR documents / CNIC / salary.

## 5. Production deployment requirements (need the hosting environment)

1. Server, domain, DNS, TLS with Caddy 2.5+ (`DEPLOYMENT_PROXY.md` §3).
2. App port private; firewall 22 / 80 / 443 only (§2).
3. Env file: `NODE_ENV=production`, `DATABASE_URL`, `TRUST_PROXY=true`, `TRUSTED_PROXY_COUNT=1`, **`FILE_STORAGE_DIR` on a persistent volume** (the server now warns if it is missing), optional `PROXY_SHARED_SECRET`.
4. `npm ci && npm run build && npm run db:migrate`. Migrations 0000–0012 are additive.
5. Live checks: real IP recorded, spoofed header ignored, app port unreachable, recording and document upload / playback through the proxy (25 MB passes Caddy; nginx would need `client_max_body_size 26m`).
   - Confirm that **notification mark-read and uploads work over HTTPS** (same-origin check, `DEPLOYMENT_PROXY.md` §10). With nginx, it must pass `Host` and `X-Forwarded-Proto`.
6. Daily `job:prune-signin-logs` scheduled, plus one manual `--dry-run`.
7. Back up the database **and** `FILE_STORAGE_DIR` together; test one restore.
8. Remove demo / verify accounts; rotate secrets (`SECURITY_AND_PRIVACY.md` §11).
9. Recommended storage controls (`FILE_STORAGE_REVIEW.md` items 1–3):
   - graceful stop;
   - disk alerts;
   - report-only ClamAV scan;
   - proxy upload rate limit and body cap.

## 6. Completion estimate

Counting the quoted FR items by verified code, not effort:
- **Built and verified:** every core module plus notifications, recordings, documents, finance reports (collections / outstanding), the dashboard (except FR-014) and drag-and-drop.
- **Independent and open:** none. The Playwright suite (test tooling, not a feature) was added in round 4.
- **Client-blocked:** leave and approvals, employee account management, attendance, Finance F3 / F5 (income, expenses, receipts), booking rules, imports, email, merge, FR-014 and the open notification rules.

Estimate: **about 82–85% of the quoted scope is built and verified; about 15% waits on client answers.** This is unchanged from round 2: rounds 3 and 4 added verification and fixes, not new scope. It is a judgement from counting requirements, not a measured figure.

## 7. Round 3 log (31 Oct 2026)

- **FR-014:** investigated; blocked on M-Q1 to M-Q5. The dashboard card now explains this instead of looking empty.
- **End-to-end workflows:** `tests/integration/workflows.test.ts` (3 tests) added; all pass.
- **File storage review** (`FILE_STORAGE_REVIEW.md`):
  - **fixed:** the upload routes now check lead access and the booked rule **before** reading the request body;
  - **added:** a one-time production warning when `FILE_STORAGE_DIR` is unset.
- **Notifications review:** all checks pass (`NOTIFICATIONS_PLAN.md` §6).
- **Final run after the fix:** 37 files, 335 / 335 tests; typecheck, lint and drift clean; build passes with 0 warnings.

## 8. Round 4 log: Playwright end-to-end suite (31 Oct 2026)

**Before adding anything.**
- Existing tests: Vitest 5 (`tests/unit`, `tests/integration`) with `tests/support/db.ts`, on `TEST_DATABASE_URL` with `resetDb` / `seedFixture`.
- No browser tooling was installed: no Playwright, Puppeteer, Cypress or Selenium. Browser QA was done by hand in the in-app browser.
- Vitest is unchanged; it still only includes `tests/**/*.test.ts`.

**Dependency and configuration changes.**
- `@playwright/test` **1.64.1**, pinned exactly, as a dev dependency. The lockfile adds only `@playwright/test`, `playwright` and `playwright-core`.
- No browser download: `channel: "chrome"` uses the installed Google Chrome.
- New script `npm run test:e2e`: runs `next build`, then `playwright test`.
- `.gitignore` adds `/test-results/`, `/playwright-report/` and `/blob-report/`.
- `playwright.config.ts`:
  - 1 worker, no retries;
  - timeouts: 60 s per test, 15 s per assertion;
  - trace and screenshot kept only on failure;
  - `desktop` project: 1440 × 900, every test except those tagged `@mobile-only`;
  - `mobile` project: Pixel 7 at 375 × 812 with touch, only tests tagged `@mobile`;
  - web server: `next start` on `127.0.0.1:3300` with `NODE_ENV=production`, `DATABASE_URL` set to the **test** database, and `FILE_STORAGE_DIR` set to a temp folder.

**Data safety.**
- `e2e/support/guard.ts` refuses to run unless `TEST_DATABASE_URL` is set, differs from `DATABASE_URL`, and names a database containing "test".
- Global setup:
  - migrates the test database (additive only);
  - runs `resetDb` + `seedFixture`;
  - adds synthetic `@test.local` users and one booking with a 500,000 cash payment.
- Uploads go only to the temp folder.
- Global teardown truncates the test database and removes the temp folder.
- Each test creates its own uniquely named records, so no test depends on another or on run order. Individual spec files were also run on their own and passed.
- After the full run:
  - dev database: 0 `E2E …` leads and 0 `@test.local` users; counts unchanged (5 leads, 11 users);
  - test database: 0 leads, 0 users, 0 files;
  - temp storage removed.

**Specs (`e2e/`).**

| Spec | Covers |
|---|---|
| `auth.spec.ts` (10) | **Signed out:** redirect to login; APIs return 401.<br>**Login:** wrong-password message.<br>**All 6 roles:** role badge; denied pages show "Access denied"; allowed pages return 200.<br>**APIs:** 403 for agent, HR, accountant and manager.<br>**Logout:** ends the session. |
| `leads-notifications.spec.ts` (3) | **Assignment:** a manager creates a lead for an agent in the UI. The agent's bell shows it; opening it marks it read and goes to the lead. "Mark all read" works. Another agent cannot see it.<br>**Lost request:** the manager is notified; after a rejection the agent is notified.<br>**Follow-up pop-up:** shown once, inside the 30-minute window. |
| `files.spec.ts` (3) | **Recording upload in the UI:** the audio element loads (1 s); `Range` returns 206 with `no-store`; an audit row is written. The manager gets 200, another agent 404 (also for upload), HR and the accountant 403.<br>**Fake WAV:** refused and not stored.<br>**PDF:** uploaded; a real browser download has identical bytes; an audit row is written. By role: 200 / 200 / 404 / 403 / 403. |
| `pipeline.spec.ts` (4) | **Mouse drag** to Contact Attempted: stage, column count and audit row updated.<br>**Drop on Lost or Booked:** refused with the message; stage and audit unchanged.<br>**Touch drag** with real touch events (mobile).<br>**HR:** no board and no drag handles. |
| `finance.spec.ts` (3) | **Accountant, today's collections:**<br>- API net is 500,000;<br>- CSV download has the header and a Total row (1 receipt, 500,000);<br>- export audit count +1.<br>**Outstanding reports:** shown.<br>**Manager, agent, HR:** "Access denied"; export 403; no audit row. |
| `dashboard.spec.ts` (3) | **Range chips:** update the URL and the selection.<br>**Custom range today..today:** Total leads KPI equals the leads API count, and goes up by 1 after a new lead.<br>**Lost leads:** a lost lead is counted under its reason, matching the Lost list API; the click-through lists it.<br>**Accountant:** sees only "—". |
| `responsive.spec.ts` (8 × 2) | **Pages at 1440 and 375 px:** dashboard, leads, pipeline, lead detail, notifications, finance reports and workspace each load with their content and no sideways page scroll.<br>**Notification dropdown:** fits the screen. |

**Reliability.**
- No fixed sleeps or `waitForTimeout`.
- Selectors: roles, labels, `data-stage`, and the new `data-kpi` / `data-kpi-value`.
- Waits are on real states: URL, unread count, status messages, and the database stage via `expect.poll`.
- File choosers retry until the upload button is enabled, which handles panels that stream in before hydration.

**Bugs found and fixed by the suite.**
1. **The same-origin check refused legitimate browser POSTs** (`src/server/http.ts`).
   - **Cause:** it compared `Origin` with `req.nextUrl.origin`, which comes from the hostname Next.js was started with.
   - **Effect:** under `next start --hostname 127.0.0.1`, and likely behind Caddy over HTTPS, every client-side `fetch` POST returned 403: uploads, notification mark-read and read-all.
   - **Fix** (`src/server/origin.ts`): the Origin's host must match the `Host` header. With `TRUST_PROXY` it may match `X-Forwarded-Host` instead, and then the scheme must match too. Cross-site, `null` and malformed origins are still refused, so CSRF protection is not weakened.
   - 7 unit tests; documented in `DEPLOYMENT_PROXY.md` §10.
2. **The bell count stayed stale after "Mark all read"** on the history page, until the next 45 s poll. The button now dispatches an event and the bell refreshes immediately.

**Storage risks reviewed** (`FILE_STORAGE_REVIEW.md` items 1–3): orphaned files after interrupted uploads, no malware scanning, no upload rate limit. For each, the review covers how it arises, its impact, and safe production controls. No cleanup, deletion or retention behaviour was added.

**Final run (all on 31 Oct 2026).**

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | Pass (exit 0) |
| Lint | `npm run lint` | Pass, 0 problems |
| Vitest | `npm test` | 38 files, 342 / 342 |
| Schema drift | `drizzle-kit check`; `drizzle-kit generate --name drift_probe` | "Everything's fine"; "No schema changes, nothing to migrate" (no file created; 13 migrations) |
| Production build and Playwright | `npm run test:e2e` | Build passes (91 / 91 pages, 0 warnings); **42 / 42** Playwright tests |
