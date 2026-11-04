# Project status and completion checklist

Updated **31 Oct 2026 (final read-only audit, §9)**. Everything below was checked against the code and by running the checks named here.
- Rounds 1–4 are committed and pushed as `e956033` on `main`.
- Nothing has been deployed.

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

The full ordered list is in `PRODUCTION_HANDOVER_CHECKLIST.md`; client-provided dependencies (H-1 to H-12) are in `VERSION_1_EXECUTION_PLAN.md` §6.


1. Server, domain, DNS, TLS with Caddy 2.5+ (`DEPLOYMENT_PROXY.md` §3).
2. App port private; firewall 22 / 80 / 443 only (§2).
3. Env file: `NODE_ENV=production`, `DATABASE_URL`, `TRUST_PROXY=true`, `TRUSTED_PROXY_COUNT=1`, **`FILE_STORAGE_DIR` on a persistent volume** (the server now warns if it is missing), optional `PROXY_SHARED_SECRET`.
4. `npm ci && npm run build && npm run db:migrate` on a **clean, separate production database**. Migrations 0000–0012 are additive. Then the controlled setup script (planned P1): client-confirmed lookup lists and the first Super Admin. `db:seed` must never run in production.
5. Live checks: real IP recorded, spoofed header ignored, app port unreachable, recording and document upload / playback through the proxy (25 MB passes Caddy; nginx would need `client_max_body_size 26m`).
   - Confirm that **notification mark-read and uploads work over HTTPS** (same-origin check, `DEPLOYMENT_PROXY.md` §10). With nginx, it must pass `Host` and `X-Forwarded-Proto`.
6. Daily `job:prune-signin-logs` scheduled, plus one manual `--dry-run`.
7. Back up the database **and** `FILE_STORAGE_DIR` together; test one restore.
8. No development accounts or development, test or fictional records exist in production (the database starts empty). Use fresh production secrets (`SECURITY_AND_PRIVACY.md` §11).
   - Check the security headers with `curl -sI https://<domain>/login` (`DEPLOYMENT_PROXY.md` §11).
   - Decide on HSTS `includeSubDomains`.
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

## 9. Final read-only audit (31 Oct 2026)

No application code, configuration or database records were changed; only this file was updated.

### 9.1 Re-run results (same day, after `e956033`)

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, 0 problems |
| `npm test` (Vitest) | 38 files, **342 / 342** |
| `drizzle-kit check` / `generate --name drift_probe` | "Everything's fine" / "No schema changes" (13 migrations, no file created) |
| `npm run test:e2e` | Production build passes (91 pages, 0 warnings); Playwright **42 / 42** in 2.4 min |

### 9.2 Repository hygiene

| Item | Finding |
|---|---|
| Working tree | Clean before this audit: nothing uncommitted needed to be kept |
| Temporary files | None tracked. Ignored local files only: `.env.local`, `.dev-credentials`, `.next/`, `test-results/` (empty), `tsconfig.tsbuildinfo` |
| Migration journal | Entries 0–12 match the 13 SQL files and 13 snapshots |
| `.env.example` | Lists every variable the code reads: `DATABASE_URL`, `TEST_DATABASE_URL`, `TRUST_PROXY`, `TRUSTED_PROXY_COUNT`, `CLIENT_IP_HEADER`, `PROXY_SHARED_SECRET`, `FILE_STORAGE_DIR`. `NODE_ENV` is set by the runtime. No session secret is needed (session tokens are random and stored hashed) |
| **Repository visibility** | **Resolved 31 Oct 2026: the repository is now private** (verified: `visibility: PRIVATE`; anonymous API access returns 404; `main` still at `e956033`, no history change). It had been public, It contains the commercial quotation (`Zeploy_Tech_Real_Estate_CRM_Quotation_Updated.*`, `quotation/`, since `d8b03b3`) and the full requirements and security docs. The files stay in the private history; nothing was rewritten. Before visibility changed, the repository was checked for integrations: no webhooks, deployments, environments, Actions workflows, Pages, deploy keys or forks; the owner is the only collaborator |
| `.claude/launch.json` | A local dev-tool file is tracked. Harmless |

### 9.3 Security items still requiring action

1. **Security headers: resolved 31 Oct 2026.**
   - `next.config.ts` now sends CSP, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `nosniff` and HSTS (`DEPLOYMENT_PROXY.md` §11).
   - The CSP uses `'unsafe-inline'` scripts because nonces are incompatible with Partial Prerendering.
   - HSTS has no `includeSubDomains` / `preload`; adding them is the client's call.
   - The file routes keep their own sandbox CSP.
   - Covered by `e2e/security-headers.spec.ts`.
2. **Repository visibility: resolved** (§9.2).
3. **Storage controls** (`FILE_STORAGE_REVIEW.md` items 1–3): graceful stop, disk alerts, report-only ClamAV scan, upload rate limit and body cap at the proxy.
4. **Live HTTPS check of the same-origin fix** behind the real proxy (`DEPLOYMENT_PROXY.md` §10).
5. **Development accounts.**
   - `db:seed` refuses `NODE_ENV=production`, but the dev database holds `@mz.local` accounts. Never copy it to production.
   - Rotate all secrets at handover (§5 step 8).
6. **2FA** is not in V1 (`SECURITY_AND_PRIVACY.md` §2: "later, unless confirmed").

### 9.4 Requirement coverage

Every FR in `REQUIREMENTS.md` is either built (§1) or on the blocker list (§4), except these out-of-scope items: FR-039 (AI call analysis), FR-040 (Meta) and FR-041 (TikTok), all quoted separately.

Partly built, with the open part listed in §4:

| FR | Built | Waiting on |
|---|---|---|
| FR-014 aging matrix | — | M-Q1–M-Q5 |
| FR-032 shared phones | View only | Merge |
| FR-043 / FR-075 CSV imports | FR-075 units (§15.1) | FR-043 leads: Q-P5 (old system's export) |
| FR-081 holds | — | Q-B2 |
| FR-084 receipts / sales order | — | Q-B5 |
| FR-142 leave | — | Q3 etc. |
| FR-152 call quality | Durations are now stored | Q: "does a recording count as a call" |
| FR-153 critical flag | — | Q-L8 |
| FR-200 / 201 / 205 income and expense | — | Q-F |
| FR-203 overdue vs schedule | Against the booking's payment plan (§15.2) | Down payment due date (C-27) |
| FR-204 receipt numbers | — | Q-F3 |

Non-functional requirements not verified:
- **NFR-02:** list pages < 1.5 s at 10k leads. No load test was run.
- **NFR-05:** Edge, Safari, and mobile Chrome / Safari on real devices. Only desktop Chrome and Chrome mobile emulation are automated.

### 9.5 Test coverage gaps

- **Service-level tests:** every module has Vitest integration tests on PostgreSQL.
- **Browser tests:** Playwright covers the eight critical workflows only.

Not covered in a browser:
- bookings, meetings, tasks / proposal builder, inventory, projects, clients, teams / roster / daily reports, targets, performance, HR employees and holidays, finance payment entry, the Security settings page;
- print layouts (proposal / payment plan): no automated test of any kind;
- click-to-call: only the `tel:` link format is unit-tested; the dialer hand-off needs a real phone.

### 9.6 Documentation consistency

- Fixed here: the header of this file said nothing since `0f24ba9` was committed.
- Historical notes, accurate for their date and left unchanged:
  - `PRODUCTION_READINESS_PLAN.md` line 434 ("these uncommitted changes"), now in `0f24ba9`;
  - `UI_FOUNDATION_NOTES.md` ("sign-in is not connected yet");
  - `IMPLEMENTATION_ROADMAP.md` dates.
- `SECURITY_AND_PRIVACY.md` §7 headers: now implemented and documented (§9.3 item 1).

### 9.7 Recommendation

*Revised 3 Nov 2026: there is no demo or presentation environment.*

**The built features are ready to be deployed to the client's production server** for handover and acceptance testing, because:
- every built workflow passes its automated tests;
- the screens show real data only;
- blocked features say what they are waiting for.

Version 1 scope, preparation work (P1–P5) and acceptance terms are in `VERSION_1_EXECUTION_PLAN.md`.

**Not ready for production use** until:
- the §5 deployment checklist is complete;
- a live HTTPS check passes, covering the same-origin fix and the five headers via `curl -sI`.

The security headers and the repository visibility, which earlier blocked production, are resolved.

The completion estimate stays at **about 82–85% of the quoted scope built and verified**. The remaining ~15% waits on the client decisions in §4.

### 9.8 Follow-up: visibility and security headers (31 Oct 2026)

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, 0 problems |
| `npm test` (Vitest) | 38 files, **342 / 342** |
| `drizzle-kit check` | "Everything's fine" |
| `npm run test:e2e` | Production build passes, 0 warnings; Playwright **47 / 47** in 3.5 min: the 42 earlier tests plus 5 in `e2e/security-headers.spec.ts` (4 desktop, 1 mobile) |
| Dev server (`next dev`, :3100) | Headers present, `unsafe-eval` only in development; the login page hydrates and fonts load with no CSP errors |

**Found while testing.** Next.js config headers replace a header that a route sets itself. A site-wide CSP therefore replaced the file routes' stricter sandbox policy, so the app CSP is not applied to `/api/`. The spec asserts that the sandbox policy is delivered.

**Files changed (uncommitted):**
- `next.config.ts`
- `e2e/security-headers.spec.ts` (new)
- `docs/DEPLOYMENT_PROXY.md` §11
- `docs/SECURITY_AND_PRIVACY.md` §7
- `docs/PROJECT_STATUS.md`

## 10. Planning after the client questionnaire (2–3 Nov 2026)

**Documents written (no code changed):**
- `CLIENT_ANSWERS_RECONCILIATION.md`;
- `POST_QUESTIONNAIRE_IMPLEMENTATION_PLAN.md`;
- `CHANGE_REQUESTS.md`;
- `REMAINING_CLIENT_CLARIFICATIONS.md`;
- `VERSION_1_EXECUTION_PLAN.md`;
- `PRODUCTION_HANDOVER_CHECKLIST.md`;
- `EXTERNAL_INTEGRATIONS.md`.

**Version 1 is the deployed CRM on the client's server.** It includes:
- E1–E3;
- production preparation P1–P5;
- E4 / E5 after signed approval.

**Production finding.** A clean database created by migrations has **no lead sources, cities, budget ranges or lost reasons, and no first Super Admin**. Those currently come only from the development seed. A controlled production setup script (P1) is therefore required work.

**Status:**
- awaiting Zeploy Tech's implementation approval;
- awaiting the client's signature (S-1) and dependencies H-1 to H-12.

The completion estimate is unchanged.

## 11. Implementation from the client questionnaire (3 Nov 2026)

Source of truth: the 53 questionnaire answers (`CLIENT_ANSWERS_RECONCILIATION.md`).

**Rules followed:**
- Nothing that removes an existing access was applied: the questionnaire is unsigned (S-1).
- No business or financial rule was invented.
- Migrations are additive only; no database was reset.
- Not committed or deployed.

### 11.1 Implemented

| Q | Change | Where | Tests |
|---|---|---|---|
| Q2, Q3 | **Account management** for Admin and Super Admin, on HR → Employees: create a CRM user, change name or role, reset password, deactivate or reactivate.<br>**Safeguards:** nobody changes their own role or status; the last active Super Admin is protected; only a Super Admin manages or grants Super Admin (C-1 default); team rules on role changes.<br>**Sessions:** deactivation, role change and password reset end the user's sessions.<br>**Auth code** is unchanged; inactive users were already refused. | `modules/accounts`, `/api/v1/users…`, `features/hr/components/account-*` | `accounts.test.ts` (9), `accounts-rules.test.ts` (4), `e2e/accounts.spec.ts` (4) |
| Q3 | **Lead shift option:** move a person's open, lost and / or booked leads (the admin chooses the groups) to an active agent or manager.<br>Each lead goes through normal reassignment: pending follow-ups move with it, and the move is logged, audited and notified. Tasks and meetings are not moved (C-2). | same | `accounts.test.ts` |
| Q1 | **HR records for staff without a CRM login:** name, optional email, employment status and profile fields; listed with accounts; "No CRM login" filter and tile; audited history.<br>Migration 0013 makes `employee_profiles.user_id` optional and adds `full_name`, `email`, `status`. | `modules/employees`, HR pages, `/dashboard/hr/employees/new-record` | `employees.test.ts` (+2) |
| Q41, Q42, Q33 | **Settings:** manager discount cap 5%; default down payment 25%; payment method "Pay order".<br>Migration 0014 changes only values nobody has edited. | `drizzle/0014`, `tasks/constants.ts` | `tasks.test.ts` |
| Q43 | **Installment due dates:** the builder requires a *First installment month*; installments are dated the 10th of consecutive months.<br>Edited schedules must keep every installment on the 10th.<br>Due dates appear on the task page and the printed proposal.<br>The down payment row stays undated (C-27).<br>Existing proposals keep their rows until edited. | `tasks/plan.ts`, `commands.ts`, task form, print | `tasks.test.ts` (+3), `tasks-rules.test.ts` (+2) |
| Q48 | **Proposals quote only Available units.** A proposal keeping its existing unit stays editable. Payment-plan tasks for a booking still use the booked unit (Q48 concerns proposals). | `tasks/commands.ts`, task form | `tasks.test.ts` |
| Q37–Q40 | Rounding on the last installment, 0% default discount, save-with-warning, agent cap 5%. | — | Unchanged, re-verified |
| Q45 (additive half) | **Admins and Super Admins can assign tasks to all users;** HR and Accountants now receive tasks and can view and update their own (no create). | `tasks/policy.ts`, navigation | `tasks.test.ts` (+1), `tasks-rules.test.ts` |
| Q25 | Performance counts leads by their **original assignment date**: creation date, or the first assignment of a lead created unassigned. Reassignments don't move it. | `performance/service.ts` | `performance.test.ts` (+1) |
| Q24, Q26, Q27, Q30, Q35, Q51 | Confirmed current behaviour | — | Existing tests |
| Q9 | **Team weekend days** (Sun–Sat, per team) in the team form; weekend columns shaded on the roster month view, plus a note in the day view. Leave is unaffected (calendar days, Q8). Migration 0016. | `teams/*`, roster views | `teams-targets.test.ts` (+1) |
| Q53 | **Super Admin can delete a call recording.** Pending C-33 it is *hidden*: removed from every list and player, recorded in the audit log and timeline, and the stored audio file is kept. Migration 0015. | `files/lead-files.ts`, recordings route and panel | `recordings.test.ts` (+1) |
| P1 | `scripts/setup-production.mjs`:<br>- **guards:** requires `NODE_ENV=production` and `--confirm-database`; never reads `.env.local`;<br>- **lookups:** client-confirmed lists from `setup/production-lookups.json` (template provided, idempotent);<br>- **first Super Admin:** hidden password prompt, never printed; refused if one already exists. | `scripts/`, `setup/` | `setup-production.test.ts` (4) |
| P2 | `scripts/ops/backup.sh` (database dump + storage archive + checksums; optional off-server rsync; no pruning) and `scripts/ops/restore-check.sh` (restores into a temporary database, compares counts, checks files, drops it), plus `RESTORE.md`. | `scripts/ops/` | Backup and in-place restore verified on the test database |

**Migrations:** 0013–0016, all additive, applied to the development and test databases. Development data after them:
- 11 users, 5 leads, unchanged;
- the seeded down payment changed from 30 to 25 and a manager cap of 5 added (both never edited before);
- "Pay order" added.

### 11.2 Kept as today until signed approval (removes existing access)
- Q31: managers approving reversals.
- Q52: agents playing recordings.
- Q36: proposal editing limited to Super Admin.
- Q45: managers and agents stop assigning tasks.

### 11.3 Not built: missing client decision (current behaviour preserved)

| Q | Missing decision | ID |
|---|---|---|
| Q4–Q8, Q10–Q17 | Leave module:<br>- who approves and in what order (C-4);<br>- Super Admin leave (C-5);<br>- cross-year rule (C-13);<br>- allowance value, proration method, leave year, cancellation flow (C-7, C-10–C-12) | C-4, C-5, C-13 |
| Q18, Q19 | Leave → roster and rotation (needs leave) | C-14, C-15 |
| Q5 | Holiday region by team: staff in several teams | C-3 |
| Q20–Q22 | Attendance: capture rules, plus the commercial decision | C-16, CR-1 |
| Q23 | Critical agent rule | C-17 |
| Q28 | Pipeline pressure formula | C-20 |
| Q29 | Receipt number format | C-21 |
| Q32 | Refund deduction and approval | C-22, CR-3 |
| Q33 (proof files) | Payment proof attachments | C-23 |
| Q34 | PDP / CDP | C-24 |
| Q44 | Floor prices (project, override rule) and ROI rate | C-28 |
| Q46 | Task statuses vs types | C-30 |
| Q47 | Current unit price on proposals (printed copy) | C-31 |
| Q49 | Floor map on printed proposals | CR-2 |
| Q50 | Sign-in log deletion stays **off** until the signed approval and a production scheduler | S-1 |
| Q53 (erase) | Permanent erase of recordings | C-33 |

### 11.4 Verification (3 Nov 2026)

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, 0 problems |
| `npm test` (Vitest) | **41 files, 371 / 371** |
| `drizzle-kit check` / `generate --name drift_probe` | "Everything's fine" / "No schema changes" (17 migrations) |
| `npm run test:e2e` | Production build passes (94 / 94 pages, 0 warnings); Playwright **51 / 51** (desktop and mobile) |

The completion estimate is not raised by this round: it implements answered rules inside quoted modules, and the main blocked modules (leave, attendance, income / expense, receipts) are unchanged.

### 11.5 Code audit of the implementation round (3 Nov 2026)

**Defects found and fixed:**

| # | Defect | Fix | Test |
|---|---|---|---|
| 1 | Creating a proposal with hand-edited rows skipped the Q43 due-date check (only updates checked it). | `createTask` checks rows too. | `tasks.test.ts` "hand-edited rows are checked on create too" |
| 2 | HR and Accountants could not open the task edit page: the form options required *create* permission, and the lead picker refused roles without lead access. | Options need create **or** edit; no lead options for roles without leads. | `tasks.test.ts` Q45 (HR edit form, hidden lead) |
| 3 | Two admins creating the same email at the same moment got a server error instead of a field error. | The unique-index violation is mapped to the email field. | Covered by the duplicate-email test path |
| 4 | The lead shift had per-lead audit rows but no record on the deactivated person's history. | One `user.leads_shift` summary row (receiver, groups, moved / matched). | `accounts.test.ts` |
| 5 | The setup script could add a lookup name that already existed in another letter case. | The insert skips case-insensitive matches. | `setup-production.test.ts` |
| 6 | `restore-check.sh` could only run with `CREATEDB`. | Optional `RESTORE_CHECK_DATABASE` scratch target (refuses the live database). Rows in the backup may never exceed live. | Full run reported OK (`scripts/ops/RESTORE.md`) |

**Answers re-checked against the implementation:**
- Q2, Q3, Q1, Q41, Q42, Q43, Q48, Q25, Q9 and Q53 match the client's wording.
- Q45 is half applied, by design: Admins assign to all users; removing managers' and agents' assigning waits for S-1.
- **Q33 is not covered by existing Finance.** Payments store only a free-text *Reference* (cheque or transaction no.). There is no attachment, and Accountants can't open lead documents. "Online receipt" and "cash images" proofs therefore need the attachment feature (in scope, after C-23).
- **Not specified by the client:** if a CRM account is later created for someone who already has a no-login HR record, the two records are separate. HR should not create both.

**Security review (server-enforced, not UI only):**
- **Account management:** every API route and server action calls the service guards.
  - An Admin can't act on or grant Super Admin.
  - Nobody changes their own role or status.
  - The last active Super Admin is protected.
  - Team role rules apply.
  - A role change, password reset or deactivation deletes the user's sessions in the same transaction.
  - Passwords are never returned, logged or audited.
- **Records without login:** they can't be attached to a user (unknown fields rejected), and the profile route can't edit them.
- **Recordings:** `DELETE /api/v1/recordings/:id` is Super Admin only (403 for agent, manager and admin in Playwright). A hidden recording is 404 for everyone, including download. The stored file is kept, and an audit row and timeline entry are written.
- **Lead shift:** every moved lead goes through `assignLead`, which checks the actor, receiver and scope and writes `lead.assign`, plus the summary row.
- **Setup script:**
  - refuses unless `NODE_ENV=production` and the database name matches;
  - never reads `.env.local`;
  - lookups are idempotent;
  - refuses a second Super Admin;
  - the password is never echoed (tested with a piped password).
- **Backups:** credentials go through libpq environment variables (`pg-env.mjs`), never command-line arguments; files are written with `umask 077`. Running the scripts with `bash -x` would print the exported values, so don't trace them.

**Migration rollback and compatibility (all additive; none reversed automatically):**

| Migration | Risk if rolled back or run against older code | Note |
|---|---|---|
| 0013 records without login | Re-adding NOT NULL on `user_id` fails once no-login records exist. Older app code ignores those rows. | Roll back only by deleting the records first: a client decision |
| 0014 due dates + defaults | Older code ignores `due_on`. The 30 → 25 down-payment change and the manager cap are data; reverting means setting them back in Tasks settings (audited). | Only values nobody had edited were changed |
| 0015 recording hide | PostgreSQL can't drop an enum value (`file_deleted`). **Older app code would show hidden recordings again**, because it doesn't read `deleted_at`. | Don't deploy older code against this schema |
| 0016 team weekends | Older code ignores the column. | — |

All 17 migrations apply cleanly to an empty test database (`e2e` global setup, every run).

**Tests added in the audit:**
- Vitest: +5 assertions or tests (tasks ×3, accounts, setup script).
- Playwright: `e2e/questionnaire-screens.spec.ts` (Q1 desktop and mobile, Q9, Q43, Q48), plus recording-delete API checks in `files.spec.ts`.

## 12. Implementation round 2 (3 Nov 2026)

### 12.1 Phase 1: payment proof attachments (Q33). Done.

**What it does:**
- Accountants and Super Admins attach receipts, screenshots or cash photos to a posted payment on its payment page.
- Formats: PDF, JPG, PNG, DOCX, XLSX, up to 10 MB, content-checked.
- Images preview inline under a sandbox CSP; other files download.

**Storage:**
- Files are private (`payment-proofs/YYYY/MM/<uuid>.<ext>`). Each is a `files` row of kind `receipt` linked to its payment by the new `payment_id` (migration 0017, additive).
- Proofs never appear among lead documents.
- Each upload is audited (`payment.proof_upload`) and shown in the payment's audit trail.

**Access:**
- **Viewing** follows itemised-payment access: finance roles, and managers for their team's bookings. Managers of other teams get 404; agents and HR get 403.
- **Uploading:** Accountant and Super Admin only. A reversal entry can't carry proof.

**Unchanged:** existing payments, their references and the record-payment form. Proof is **optional** until the client confirms (C-23).

**Code:**
- `modules/finance/proofs.ts`;
- `/api/v1/finance/payments/:id/proofs` (GET, POST) and `/api/v1/finance/proofs/:id` (GET);
- the documents panel, generalised; the lead documents panel is unchanged.

**Tests:** `payment-proofs.test.ts` (3); `e2e/payment-proofs.spec.ts` (1: attach, preview, download, role checks).

### 12.2 Phase 2: leave management (Q4–Q19). Done, except the isolated decisions.

**Built:**
- **Employees, in My Workplace:** request leave, see balance and history, withdraw a pending request, request cancellation of approved leave.
- **Approvers, HR and admins, in HR → Leave:**
  - waiting decisions;
  - cancellation requests;
  - all requests: HR, Admin and Super Admin see everyone; managers see their teams;
  - leave settings (Admin, Super Admin).
- Migration 0018: `leave_requests`, `leave_decisions`, `roster_entries.leave_request_id`, all additive.

| Answer | Implementation |
|---|---|
| Q4 | One allowance for everyone: setting **30 days** by default (value to confirm, C-7) |
| Q8 | Calendar days, inclusive; weekends and holidays count |
| Q10, Q11 | Types "Annual" and "Medical (CPL)"; both come out of the annual allowance |
| Q12 | A request over the remaining balance is refused, with the days left. Pending requests hold their days |
| Q13 | Joiners are prorated from the joining date. **Provisional method** (calendar-day share, nearest half day), isolated in `proratedAllowance` until C-10 |
| Q14 | No carry-forward: each calendar year starts again (leave year to confirm, C-11) |
| Q16 | Past dates allowed. Overlapping requests refused (FR-142) |
| Q7 | Leave of Managers, HR, Admins and Super Admins is approved by a **Super Admin**. Admins can't. **Nobody approves their own leave**, so a Super Admin's own leave needs another Super Admin (C-5 pending) |
| Q6 | Agents' and accountants' leave needs **two steps**. Who approves each step is an **Admin setting** (Team manager / HR / Admin), **left unset** until the client confirms the order (C-4). Until then those requests stay pending, with a notice. Once set, the steps run in order, and a rejection at either step ends the request |
| Q15 | Cancelling approved leave: the employee requests it and an Admin or Super Admin decides, or an Admin / Super Admin cancels directly with a reason. Cancelled days return to the balance |
| Q17 | **Isolated:** a request spanning two calendar years is refused with a message ("submit one request per year") until C-13. A database check enforces it too |
| Q18 | On final approval, each day is written to the roster as "On leave" on the person's first active team. **A day a manager already set is not replaced** (C-14). Cancelling removes only the days written by that leave |
| Q19 | Automatic lead rotation skips agents whose approved leave covers today (Pakistan date). "Leads off" and manual assignment are unchanged (C-15) |
| Q9 | Team weekends were done in round 1; under calendar-day counting they don't change leave |

**Audit:** `leave.request`, `.approve_step`, `.approve`, `.reject`, `.withdraw`, `.cancel_request`, `.cancel`, `.cancel_refused`; setting changes as `app.setting`.

**Not built:** leave for staff without a CRM login (C-6); leave notifications (N4 open).

**Tests:**
- `leave-rules.test.ts` (4);
- `leave.test.ts` (9): balances, blocks, the Super Admin path, the staff steps, roster, cancellation, rotation, visibility;
- `e2e/leave.spec.ts` (3 tests; 4 runs with mobile).

### 12.3 Phase 3: finance and proposals. Done for what is defined.
- **Q47, proposals follow unit price changes:**
  - Saving a proposal now uses the unit's **current** price and area. It previously kept the price from the first save. The ROI rate stays as saved.
  - A proposal saved before a price change shows a notice on its page and on the print screen (not on paper) until it is saved again.
  - Records are only recalculated when someone saves them.
  - Whether a copy of each printed version must be kept is C-31.
  - Test: `tasks.test.ts` "Q47".
- **Not built: missing definitions.** Receipt format (C-21), PDP / CDP (C-24), refunds with deductions (C-22, CR-3), floor prices and ROI (C-28), task statuses (C-30).
- **Not applied: removes existing access.** Manager reversal approval (Q31) and Super-Admin-only proposal editing (Q36).

### 12.4 Phase 4: remaining modules. Done for what is defined.
- **Q5, holiday region by team:**
  - Teams have a "Holiday region" (migration 0019).
  - My Workplace shows company holidays plus the regional holidays of the person's teams' regions, matched ignoring case.
  - Staff in several teams see all their teams' regions (C-3 pending), so nothing relevant is hidden.
  - Without a team region, every regional holiday is still listed, as before.
  - Test: `workplace.test.ts` "Q5".
- **Defect fixed:** the leave balance ran parallel queries inside a transaction; `pg` warned about this at runtime. It now runs them in sequence.
- **Nothing else is defined and additive:**
  - Dashboard: aging matrix (M-Q1–M-Q5), Critical (C-17) and Pipeline pressure (C-20) need definitions.
  - Notifications: no new events defined (N2–N6).
  - Attendance: commercial decision (CR-1) and C-16.
  - Sign-in log deletion: needs S-1.

### 12.5 Verification (3 Nov 2026, end of round 2)

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, 0 problems |
| `npm test` (Vitest) | **44 files, 390 / 390** |
| `drizzle-kit check` / `generate --name drift_probe` | "Everything's fine" / "No schema changes" (20 migrations) |
| `npm run test:e2e` | Production build passes (96 / 96 pages, 0 warnings, no runtime warnings); Playwright **61 / 61** (desktop and mobile) |

Migrations 0017–0019 are additive and applied to the development and test databases. The development database still has its 11 users, 5 leads and 6 payments; no leave was created there.

## 13. Corrections and round 3 (3 Nov 2026)

### 13.1 Corrections to round 2

| Item | Was | Now |
|---|---|---|
| **Q47: proposals reflect unit price changes** | The new price applied only when someone saved the proposal again, which doesn't meet "reflect unit changes" | **Automatic.** When a unit's price or area changes (`updateUnit`), every Proposal on that unit that isn't cancelled is recalculated in the same transaction: price, total, discount amount, down payment and installments. Discount %, down payment %, installment count and ROI stay as saved. A generated schedule is regenerated; a hand-edited schedule is **kept** and flagged in the history ("edited schedule kept: check the rows"). Each change writes a task-history entry and a `task.price_sync` audit row with the **previous and new figures**, so the original quote is never lost. Booking payment plans keep their agreed rate. A proposal saved before this release still shows the price-changed notice until its unit changes again or it is saved |
| **Q17: cross-year leave** | Refused, which wasn't a client rule | **Accepted and held.** The request is recorded but counts against **neither year's** balance, can't be approved by anyone, still blocks overlapping days and can be withdrawn. The employee and HR see "Held: spans two calendar years…". The database check that forbade such requests was relaxed (migration 0020). The rule waits for C-13 |
| **Leave proration** | One hard-coded provisional function | **Configurable.** Methods are registered in `PRORATION_METHODS` and chosen in Leave settings (`leave.proration_method`). The only method so far is labelled provisional wherever it appears (Leave settings; My leave shows "Prorated from joining date (provisional method)"). Adding the confirmed method is one entry |
| **Payment proof permissions** | Tested through the UI and role checks | **Re-verified against the Finance model:** viewing = itemised-payment access (finance roles; team manager for their bookings); uploading = payment recorders (Accountant, Super Admin). New tests: signed-out file and list requests get 401; agent and HR get 403 on file, download and list; a proof id is 404 through the lead document and recording routes, even for a Super Admin |

**The provisional proration formula (not client-approved):**
- **Formula:** `allowance = round to nearest 0.5 day of ( annualDays × days from joining date to 31 Dec inclusive ÷ days in year )`.
- **Example:** 30 days, joining 2 July 2026: 30 × 183 ÷ 365 = 15.04 → **15**.
- **Edge cases:** someone who joined in an earlier year, or has no joining date, gets the full allowance; joining in a later year gives 0.

### 13.2 New: income and expense records (FR-200, FR-201, FR-205)

**What was built:**
- **Finance → Income & expenses:** list with kind and date filters and totals; recording; a detail page with edit, attachments, void and history.
- **Categories:** Finance → Settings → "Income and expense categories" (Super Admin), deactivated rather than deleted. The lists are the client's (Q-F4); none are seeded.
- **Report:** Finance → Reports → "Income vs expense by month" for a year, with an audited CSV (`income_expense`).

**Access** follows the existing Finance model:
- view: Super Admin, Admin, Accountant;
- record, edit, void and attach: Accountant, Super Admin;
- categories: Super Admin;
- managers, agents and HR are refused.

**Fields** (FR-200 / 201):
- category, amount, date, method (optional), reference, note;
- payee, for expenses only;
- attachments (PDF, JPG, PNG, DOCX, XLSX; private; content-checked).

**Never deleted:**
- Voiding needs a reason and keeps the figures. Voided entries are excluded from totals and listed only on request.
- Edits are audited with before and after values; a voided entry can't be edited.

**Migration 0021 (additive or relaxing):** `finance_categories`, `finance_entries`, `files.finance_entry_id`, and `files.lead_id` made optional with a check that every file still belongs to a lead or an entry.

**Tests:** `finance-entries.test.ts` (5); `e2e/finance-entries.spec.ts` (1: category, record, attach, Admin view-only, void).

### 13.3 Still not built (current behaviour preserved)
- **Undefined:** receipt format (C-21), PDP / CDP (C-24), refunds (C-22, CR-3), floor prices and ROI (C-28), task statuses (C-30), Critical (C-17), Pipeline pressure (C-20), aging matrix (M-Q1–M-Q5).
- **No events specified:** notifications (N2–N6).
- **Commercial decision:** attendance (CR-1, C-16).
- **Leave decisions:** staff step order (C-4), cross-year deduction (C-13), proration method (C-10).
- **Waiting on the signature (S-1):** Q31, Q36, Q45 (removal half), Q52, Q50.

### 13.4 Verification (3 Nov 2026, end of round 3)

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, 0 problems |
| `npm test` (Vitest) | **45 files, 396 / 396** |
| `drizzle-kit check` / `generate --name drift_probe` | "Everything's fine" / "No schema changes" (22 migrations) |
| Production build | Pass (99 / 99 pages, 0 warnings) |
| Playwright | **62 / 62** (desktop and mobile) |

**One flaky assertion fixed.** The new income / expense spec failed once in the full run: it waited for a status message that disappears when the page refreshes after voiding. It now waits for the voided state. It then passed 3 / 3 alone and 62 / 62 in the full suite.

## 14. Round 4 (3 Nov 2026)

### 14.1 Q47: reconciling proposals saved before automatic sync

**What was built:** Tasks → Proposal settings → "Proposal price reconciliation (Q47)", plus `GET` and `POST /api/v1/tasks/proposal-reconciliation`. Admin and Super Admin only.

**The report** is a dry run that writes nothing. It lists every saved plan whose stored unit price or area differs from its unit today, with the saved and current price per sq ft, the saved and current total, and the action that applying would take:

| Action | When |
|---|---|
| Recalculate and regenerate the schedule | Proposal not cancelled, schedule as generated |
| Recalculate; keep the hand-edited schedule | Proposal not cancelled, rows edited by hand |
| Not changed: cancelled | Cancelled proposals are reported, never changed |
| Not changed: booking payment plan | Payment plans keep their booking's agreed rate |

**Applying** is a deliberate button or API call by an Admin or Super Admin. It is **not run as part of any deployment** and was **not run on the development database**.
- It uses the same recalculation as the automatic sync.
- Each changed proposal gets a `price_sync` history entry (trigger `reconciliation`) and an audit row with the previous and new figures.
- The run itself is audited (`task.price_reconciliation` with counts).
- It is **idempotent**: an updated proposal no longer differs, so a second run changes nothing.

**Development database, read only:** 2 saved plans, **0 differ** from their units.

**Test:** `tasks.test.ts` "Q47 reconciliation" covers each action, report-is-read-only, permissions, history and idempotency.

### 14.2 HR: linking an existing no-login record to a new account (Q1, Q2)
- When an Admin creates a CRM user, they can pick an existing HR record without a login. A record's page also has "Create a CRM login for this employee".
- The record is **linked, not duplicated**: its profile fields and earlier history move to the account (`employee.record_link` audited), and the person is listed once.
- A record can't be linked twice.
- Test: `accounts.test.ts` "Q1 … linked".

### 14.3 Leave balances (quotation: "Leave balances")
- HR → Leave → "Balances · year": allowance (marked "prorated (provisional)" where it applies), taken, pending and remaining for every active user (HR, Admin, Super Admin) or the manager's team.
- Each employee's page shows their balance to HR, admins and their team manager.
- Held cross-year requests are not counted.
- Tests: `leave.test.ts` "leave balances"; `e2e/leave.spec.ts` "HR sees everyone's leave balances".

### 14.4 Still not built (no defined rule; current behaviour kept)
- Refund deductions; receipt numbering; PDP / CDP; Critical agent rule; Pipeline pressure; ROI rate and floor prices; attendance policy; task status definitions; aging matrix.
- New notification events (N2–N6, including leave).
- Staff leave approval order (C-4); cross-year deduction (C-13); proration method (C-10).
- Access removals waiting for the signed questionnaire (S-1).

### 14.5 Verification (3 Nov 2026, end of round 4)

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, 0 problems |
| `npm test` (Vitest) | **45 files, 399 / 399** |
| Schema drift | "Everything's fine" / "No schema changes" (22 migrations; no new migration this round) |
| Production build | Pass (100 / 100 pages, 0 warnings) |
| Playwright | **64 / 64** (desktop and mobile), no runtime warnings |

## 15. Round 5 (3 Nov 2026)

### 15.1 FR-075: importing units from CSV
- Inventory → "Import CSV" (Super Admin and Admin, the roles that add units by hand). Choose a project and a CSV file (at most 2,000 rows and 2 MB). A template can be downloaded from the page.
- Columns: `unit_no`, `floor`, `block`, `area_sqft`, `base_price`, `sale_model`, `nature`, `category`, `type`, `bedrooms`, `premium`, `comment`, `listed_on`. Required: `unit_no`, `area_sqft` and `base_price`. Unknown or missing headers are refused before any row is read.
- **Check file** runs every row through the same rules as adding a unit by hand (field validation, the project's dimension lists, unique unit numbers, including duplicates inside the file). It writes nothing and shows a validation report: line, unit, and the reason for each failed row.
- **Import units** is enabled only after a clean check of the same file and project. It adds all rows or none, so a file with any error changes nothing. New units start as Available.
- Each new unit is audited (`unit.create`), plus one `unit.import` summary row.
- Tests: `unit-import.test.ts` (CSV parsing; check writes nothing; row errors by line with nothing imported; clean import audited; bad headers and roles refused); `e2e/inventory-import.spec.ts`.
- **Lead import (FR-043) is still not built:** it depends on the old system's export format (Q-P5).

### 15.2 FR-203: overdue against the payment plan
- Finance → Outstanding now has "Due to date (plan)" and "Overdue" columns, an "Overdue" total, and an "Overdue on plan" filter.
- **Schedule:** the booking's payment plan, meaning its most recent Payment-plan task that isn't cancelled. Its installments carry due dates (the 10th of the month, Q43).
- **Due to date:** the plan's installments dated on or before today (Pakistan date).
- **Overdue:** due to date minus net paid (after reversals), never below zero.
- **What is not counted:** rows without a date are left out, and the screen says how many. This covers the down payment until C-27 is answered, and plans saved before due dates existed.
- **No plan:** a booking without a payment plan shows "No plan". No figure is guessed.
- No new formula or policy was introduced. There are no late fees and no grace period. The figure is a plain comparison of the agreed schedule with posted payments.
- Test: `finance.test.ts` "overdue against the payment plan (FR-203)" covers past, future and undated rows, cancelled plans being ignored, a booking without a plan, the totals and the filter.

### 15.3 Still not built (no defined rule; current behaviour kept)
- Lead import format (FR-043, Q-P5); receipt / sales-order layout (FR-084, "to be provided by client"); merging shared-phone leads and deleting leads (no rule given).
- Refund deductions; receipt numbering; PDP / CDP; Critical agent rule; Pipeline pressure; ROI rate and floor prices; attendance policy; task status definitions; aging matrix.
- New notification events (N2–N6); staff leave approval order (C-4); cross-year deduction (C-13); proration method (C-10).
- Access removals waiting for the signed questionnaire (S-1).

### 15.4 Verification (3 Nov 2026, end of round 5)

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, 0 problems |
| `npm test` (Vitest) | **46 files, 405 / 405** |
| Schema drift | "Everything's fine" / "No schema changes" (22 migrations; no new migration this round) |
| Production build | Pass (101 / 101 pages, 0 warnings) |
| Playwright | **67 tests** (desktop and mobile). Run 1: 66 / 67, the new import spec failed on an ambiguous "Project" label (fixed; then 3 / 3 alone). Run 2: 65 / 67, two notification specs not changed this round timed out during a slow run (10 min vs 3.7 min); re-run twice each: 38 / 38 |

## 16. Round 6 (3 Nov 2026)

### 16.1 Playwright stability: what caused the timeouts
- **Symptom:** in round 5, two notification specs timed out in one full run ("follow-up reminders appear as a pop-up once", "the notification dropdown fits the screen"). In a later run, "a Super Admin adds a category … voids it" timed out instead.
- **Checked and ruled out:**
  - **Shared data:** no other spec creates follow-ups, and the reminder spec creates its own lead. The dropdown spec only opens the bell.
  - **Parallel execution:** Playwright runs one worker, and the test database had no other sessions.
  - **Selectors:** each failing step uses role-based locators that pass in every normal run.
- **Cause: CPU contention on the machine.** Per-test timings from the failed run, compared with a clean run, show bursts where every test ran 3–8× slower.
  - Example: the document upload spec took 40.9 s instead of 7.4 s.
  - The bursts lined up with type checks and other work run at the same time as the suite.
  - The trace of the failed income / expense spec shows it was not stuck. Every step was simply 2–5× slower (navigations 2–4 s, new browser contexts about 2 s), until the 60 s test limit.
- **Action:**
  - The suite must run on an otherwise idle machine. This is now stated here and in the Playwright config comment.
  - No timeouts were raised, no retries were added and no test was skipped.
  - The three runs below were made with nothing else running.

### 16.2 Unit CSV import: hardened and fully tested
- **Fixed: an unclosed quote** used to swallow the rest of the file silently. It is now refused, naming the line where the quote starts.
- **Fixed: a row with more values than the header** (usually an unquoted comma in a price) had its extra values dropped silently. It is now reported on that row. Trailing empty cells are still accepted.
- **Fixed: line numbers.** The report now uses each row's real line in the file, even with blank lines or line breaks inside quoted values.
- **Fixed: wrong message for a non-number.** A non-numeric area or price (for example "abc") was reported as "is required". It now says "must be a number". The same validator is used by the unit forms.
- **Tests (`unit-import.test.ts`, 13):**
  - parsing, line numbers and unclosed quotes;
  - numeric, decimal, date and required-field errors per row, plus a valid row with thousands separators;
  - duplicate unit numbers (case-insensitive) within the file and against existing units;
  - atomic rollback when a later row fails, with no audit rows written;
  - roles: Super Admin and Admin allowed; Manager, Agent, HR and Accountant refused;
  - audit: one `unit.import` summary with the count, and one `unit.create` per unit.

### 16.3 Overdue (FR-203): calculation tests
`finance.test.ts` → "overdue against the payment plan" now covers:
- partial payments, including paisa;
- overpaying the schedule, which never goes below zero;
- reversed payments: a requested but undecided reversal still counts, an approved one doesn't;
- multiple, future and undated installments;
- cancelled plans, and the most recent open plan when there are several;
- bookings without a plan;
- the Pakistan date boundary: an installment due on the 10th counts from 19:00 UTC on the 9th;
- totals equal to the sum of the rows, with each booking's Paid checked against its `booking_payments` rows.

`outstandingBookings` now accepts the business date, so these tests don't depend on the clock.

### 16.4 Next defined requirements (built)
| Requirement | What was built |
|---|---|
| FR-200 / FR-201 / FR-205 "totals reconcile with records" | **Income & expenses totals were computed from at most 500 listed rows.** They are now summed in the database over every matching entry, and voided entries are never counted. The list pages 50 at a time, and search covers payee, reference, note and category. |
| FINANCE_MODULE_PLAN §4: payment filters include "method" | **Payments → Method filter.** A reversal follows the method of the payment it reverses. |
| FINANCE_MODULE_PLAN §4: Outstanding "filters project / agent / milestone" | **Outstanding → Sales agent filter.** It lists the agents that have open bookings. |
| HR_MODULE_PLAN: "Leave filters drawer (Search, Status, Leave type, Clear all), sorting and pagination"; FR-005 | **HR → Leave → All requests:** search (employee, reason), status and type filters, Clear all, sortable Employee / Type / Dates / Status / Requested columns, and 50 per page. "Waiting for your decision" and cancellation requests now cover every year and ignore the list filters, so a filter can never hide a request that needs a decision. |
| MODULES_AND_FEATURES §11: "My leave … by year" | **A year selector on HR → Leave** (requests and balances) **and on My Workplace → My leave.** Calendar years are used, as before; the leave-year question (C-11) is still open. |
| FR-005 column sorting | **Bookings list:** sortable Lead, Sales agent, Unit, Project, Stage, Paid (net of reversals) and Updated. |
| MODULES_AND_FEATURES §1: "KPI tiles link to Leads, Won, Regenerated" | **Dashboard:** Total leads, Won / Lost and Regenerated open their lists for the same days. The "Reports" target is not named, so no link was added for it. |

Tests:
- Integration:
  - `finance-entries.test.ts`: totals across pages, search, voided entries;
  - `finance.test.ts`: method filter, agent filter, bookings sorting;
  - `leave.test.ts`: paging, filters, sorting, years, and decisions from other years.
- Browser: `e2e/list-controls.spec.ts` (desktop and mobile).

### 16.5 Still not built (no defined rule; current behaviour kept)
Unchanged from §15.3:
- lead import format (Q-P5);
- receipt layout and numbering;
- PDP / CDP;
- refunds;
- Critical and Pipeline pressure;
- ROI and floor prices;
- attendance;
- task statuses;
- the aging matrix;
- notification events N2–N6;
- leave decisions C-4, C-10 and C-13;
- access removals waiting for the signature (S-1).

### 16.6 Verification (3 Nov 2026, end of round 6)

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, 0 problems |
| `npm test` (Vitest) | **46 files, 426 / 426** |
| Schema drift | "Everything's fine" / "No schema changes" (22 migrations; no new migration) |
| Production build | Pass (101 / 101 pages) |
| Playwright, three consecutive full runs (idle machine, no retries) | **72 / 72, 72 / 72, 72 / 72** (4.1, 4.3 and 5.5 min; desktop and mobile) |

**One unexplained Vitest stall.** During development, `finance.test.ts` had two tests fail at about 10 s (the hook timeout) in one run out of five. The next three consecutive runs of that file passed 25 / 25, and the test database had no other sessions. It couldn't be reproduced and is recorded here rather than hidden.

## 17. Requirement-by-requirement completion audit (3 Nov 2026, after round 6)

**Method.**
- **Source of truth:** the signed-off quotation (14 modules and their feature lines) and the client's 53 questionnaire answers. `REQUIREMENTS.md` (FR-001 – FR-206, NFR-01 – 07) is the breakdown of the quotation and is used as the row list.
- **How each row was checked:** against the service, the page, the API and the permission policy, and against its tests. Pages, buttons or fields were not taken as proof on their own.
- **Spot-checks:** the high-impact findings were checked again directly in the code (F-1, F-2, F-6, F-7, FR-204).
- **Verification runs:** no code was changed and no tests were re-run for this audit. The round 6 results below are the latest.

### 17.A Executive summary

| Set | Rows | Result |
|---|---|---|
| Functional requirements (quotation breakdown) | 85 | 60 Implemented · 13 Partially Implemented · 0 Not Implemented · 12 Blocked |
| Non-functional requirements | 7 | 2 Implemented · 3 Partially Implemented · 0 Not Implemented · 2 Blocked |
| Questionnaire answers | 53 | 28 Implemented · 8 Partially Implemented · 0 Not Implemented · 17 Blocked |

- **Overall completion: about 81 %** of the agreed functional requirements, counting a partial as half. This leaves out the 3 excluded integrations (FR-039 AI, FR-040 Meta, FR-041 TikTok). See §17.H.
- **Nothing in the quotation is "Not Implemented" without a reason.** Every gap is either a defined fix (§17.C) or waits on the client (§17.D).
- **Remaining agreed development is small:** about 6–7 developer-days (§17.C). It covers:
  - one data-integrity defect (F-1);
  - two to-do and duplicate correctness defects (F-2, F-3);
  - audit-log completeness;
  - list consistency;
  - three small feature gaps;
  - test coverage.
- **The client decides the rest.** These items are blocked:
  - receipts and sales order layout and numbering;
  - hold expiry;
  - SPU and 50% shares;
  - refunds;
  - PDP / CDP;
  - attendance (CR-1);
  - Critical and Pipeline pressure;
  - floor prices and ROI;
  - task statuses;
  - leave approval order, cross-year leave and proration;
  - lead import format and merge rules;
  - the access removals that wait for the signature (S-1).
- **Production readiness:** the code and scripts are ready. The server, domain, backups and live checks are not, and depend on client inputs H-1 – H-12. The runbook (P3) and administrator guide (P4) are not written, and the clean-install rehearsal (P5) is not recorded (§17.E).

### 17.B Complete requirement matrix

#### Functional requirements
| ID | Requirement | Status | Current implementation | Code | Tests | Evidence / gap | Remaining work | Dependency |
|---|---|---|---|---|---|---|---|---|
| FR-001 | Email + password sign-in; session until logout / expiry | Implemented | Argon2id, hashed session tokens, 12 h idle / 7 d absolute, logout | src/server/auth/login.ts, session-store.ts | e2e/auth.spec.ts, security.test.ts | Wrong password and sign-out tested in browser | — | — |
| FR-002 | Sign-in / sign-out logged with time and IP | Implemented | Rows with verified IP + user agent; own log in My Workplace; counted in Performance | src/server/auth/session-store.ts, src/modules/workplace/service.ts | workplace.test.ts, security.test.ts | Inserted on sign-in and sign-out | Expired sessions write no sign-out row (acceptable) | — |
| FR-003 | Access denied card + API 403 | Implemented | Policy per module; RestrictedState card; API 403 / 404 out of scope. HR / Accountant land on a dashboard with empty states by design | src/components/ui/empty-state.tsx, src/server/http.ts | auth.spec.ts (every role), module integration tests | Per-role page + API refusal tests | — | — |
| FR-004 | Global project selector, remembered per user and device | Partially Implemented | Header selector stores the project in a per-device cookie; lists, inventory, bookings and dashboard follow it | src/server/project-scope.ts, src/components/shell/header.tsx | e2e selectTestProject | Cookie is per device, not per user | Remember the choice per user (two users on one device share it today) | — |
| FR-005 | Lists: search, filters, sorting, 50 per page | Partially Implemented | Leads, clients, bookings, inventory, payments, entries, employees, leave: all four. Meetings 25, tasks 25, performance 25, sign-in log 25, notifications 20, projects 24; projects and teams not sortable | src/modules/*/constants.ts | list-controls.spec.ts, module query tests | PAGE_SIZE constants | 50 per page on the remaining lists; sorting on projects and teams | — |
| FR-006 | Notifications, unread count, follow-up pop-up | Implemented | Bell with unread count, polling, once-per-session follow-up pop-up; reminder window is an admin setting | src/modules/notifications/service.ts, notification-bell.tsx | notifications.test.ts, leads-notifications.spec.ts | Pop-up tested in browser | Production: set the reminder minutes (off until set) | N2–N6 (other events) undefined |
| FR-007 | Responsive, hamburger below tablet | Implemented | Sidebar collapses; no overflow at 375 / 768 / 1440 px | src/components/shell/app-shell.tsx | responsive.spec.ts | Overflow checks on key pages | Real-device check (NFR-05) | — |
| FR-008 | Create / update / delete on business records audit-logged | Partially Implemented | audit_logs with before / after in most commands | src/modules/*/commands.ts | module integration tests | Lead notes, follow-ups, reviews, favourites and client notes / follow-ups write timeline rows only; audit_logs.ip never written; no audit-log viewer (SECURITY_AND_PRIVACY §3: 'Admins can view audit logs') | Add audit rows for those commands, store IP, add an admin audit-log view | — |
| FR-009 | App settings: discount cap, price / sq ft, ROI / sq ft, rotation | Implemented | Settings screens in Tasks, Teams, Notifications, Security, Leave; all audited; affect new proposals and assignments | src/modules/tasks/settings.ts | tasks.test.ts, notifications.test.ts | Cap and defaults tested | Values (price / sq ft, ROI) to enter | C-28 (values) |
| FR-010 | KPI tiles | Implemented | Total / open / won / lost %, conversion, open pipeline, regenerated; tiles link to the lists | src/modules/dashboard/queries.ts | dashboard.test.ts, dashboard.spec.ts, list-controls.spec.ts | KPI equals leads list for same range | — | — |
| FR-011 | Range chips + team filter | Implemented | 24h / 7d / 30d / MTD / 6m / Custom; team filter for managers | executive-essentials.tsx | dashboard.spec.ts | Chips update URL and figures | Pipeline-health counts are 'as of now', not range-bound (L) | — |
| FR-012 | Source and inbound channel breakdown | Implemented | Counts and % by source and channel | src/modules/dashboard/queries.ts | dashboard.test.ts | Totals equal in-range count | — | — |
| FR-013 | Pipeline health (stale ≥14 d, no meeting, meetings done) | Implemented | Computed per project as of now | src/modules/dashboard/queries.ts | dashboard.test.ts | Stale rule tested | — | — |
| FR-014 | Aging × meetings matrix | Blocked | Card explains it is waiting; no rows | pipeline-health.tsx | none | rows: [] | Build when defined | M-Q1–M-Q5 (definitions) |
| FR-015 | Recent leads (20) and top projects | Implemented | Rows open the lead | recent-leads.tsx | dashboard.spec.ts | Linked rows | — | — |
| FR-016 | Lost by reason and by team | Implemented | Reason opens filtered Lost list; team rows expand | lost-leads.tsx | dashboard.test.ts, dashboard.spec.ts | Click-through tested | Owner in several teams counted under each (D1 proposal) | D1 (multi-team owner) |
| FR-020 | Create lead with required fields and 8-char code | Implemented | Validated create, unique code, audit + timeline | src/modules/leads/commands.ts | leads.test.ts, leads-notifications.spec.ts | Code and field errors tested | — | — |
| FR-021 | Ten stages, change logged from → to | Implemented | Fixed stages; Booked only via Bookings; Lost via lost flow | src/modules/leads/rules.ts | leads.test.ts, pipeline.spec.ts | stage_change rows | See finding F-1 (active booking) | — |
| FR-022 | Leads table, reference columns, sortable | Implemented | All columns, sortable, search, 50 / page | leads-table.tsx, leads/queries.ts | leads.test.ts | Sort map covers all columns | More sort tests | — |
| FR-023 | Kanban by stage with counts; table toggle | Implemented | Drag moves stage with permission | kanban-board.tsx | pipeline.spec.ts (desktop + touch) | Drag tested | — | — |
| FR-024 | Pipeline filters combined with AND | Implemented | Stage, follow-up window, source, priority, city, lost reason, date field + range | leads/queries.ts | leads.test.ts | One AND list | Tests for source / city / date filters | — |
| FR-025 | Lead detail with timeline and files | Implemented | Facts, newest-first timeline, notes, follow-ups, documents, recordings, edits | leads/[id]/page.tsx | leads.test.ts, files.spec.ts | All actions write timeline rows | — | — |
| FR-026 | Follow-ups; overdue in To-dos; follow-up % | Implemented | Schedule / complete; % in Performance | leads/follow-ups.ts | leads.test.ts, performance.test.ts | Schedule and complete tested | — | — |
| FR-027 | To-dos buckets, counts match lists | Partially Implemented | 8 lead buckets + overdue tasks / meetings | leads/queries.ts (leadTodos) | leads.test.ts (doneToday) | Pending follow-ups of Lost / Booked leads stay in Today / Overdue: no stage filter, and losing a lead doesn't close them (F-2) | Exclude closed leads' follow-ups; tests for each bucket | — |
| FR-028 | Time to first touch | Implemented | firstTouchAt from note, file, follow-up, meeting, booking, stage change | leads/support.ts | recordings.test.ts | Set once | — | — |
| FR-029 | Rotation among active agents of active teams | Implemented | Locked round-robin per project; skips inactive teams and agents on leave; timeline 'rotation' | leads/commands.ts (rotateOwner) | leads.test.ts, leave.test.ts | Even rotation tested | — | — |
| FR-030 | Manual reassignment, logged | Implemented | Manager (team) / admin; moves pending follow-ups; audit + notification | leads/commands.ts (assignLead) | leads.test.ts, accounts.test.ts | Scope refusal tested | — | C-15 (warn on leave) |
| FR-031 | Duplicate detection on phone | Partially Implemented | Same-project phone match: regenerate, or saved as Duplicate linked to the original (agreed rule, LEADS_MODULE_PLAN Q1) | leads/commands.ts:135 | leads.test.ts | Create path tested | Editing a lead's phone skips the duplicate check (F-3) | — |
| FR-032 | Shared-phone groups; merge or reassign | Blocked | View only | phone-overlap/page.tsx | leads.test.ts (empty case) | No merge command | Merge after rules | Merge 1–6 (LEADS_MODULE_PLAN §13) |
| FR-033 | Regenerated leads, unworked first | Implemented | Flag, timeline, owner notified, sorted unworked first | leads/commands.ts | leads.test.ts | Flag + sort | — | — |
| FR-034 | Favourites per user | Implemented | Own stars only | leads/commands.ts (setFavorite) | leads.test.ts | Other users' stars hidden | — | — |
| FR-035 | Lost with reason; agent requests need approval | Implemented | One pending request per lead; decision logged and notified | leads/commands.ts | leads.test.ts, leads-notifications.spec.ts | Approve / reject tested | — | — |
| FR-036 | Manager reviews visible to agent | Implemented | Reviews feed scoped to own leads | leads/queries.ts | leads.test.ts | Scope filter | Positive-path test | — |
| FR-037 | Won view = Booked | Implemented | View filter stage = booked | leads/won/page.tsx | bookings.test.ts (indirect) | — | — | — |
| FR-038 | Recordings and documents, type and size validated | Implemented | Sniffed types, 25 MB / 10 MB, private storage | recordings/validation.ts, documents/validation.ts | recordings.test.ts, documents.test.ts, files.spec.ts | Disguised and oversized files refused | — | — |
| FR-039 | AI call analysis | Blocked | Not built | — | none | — | — | Excluded integration (separate quote) |
| FR-040 | Meta lead ads | Blocked | Channel label only | — | none | — | — | Excluded integration (client credentials, approval) |
| FR-041 | TikTok lead ads | Blocked | Channel label only | — | none | — | — | Excluded integration (client credentials, approval) |
| FR-042 | City from managed list, with 'Other' | Partially Implemented | Select from the cities lookup (FK); free text impossible | leads/validation.ts, lead-fields.tsx | none | No 'Other' option | Add 'Other' with a validated free-text city; test | — |
| FR-043 | Lead CSV import (migration) | Blocked | Not built | — | none | — | Build importer | Q-P5 (SaleStorm export sample) |
| FR-050 | Client created at Confirmed or by admin | Implemented | ensureClientForLead on confirm; manual convert | bookings/commands.ts, clients/commands.ts | bookings.test.ts, clients.test.ts | Confirm creates client | — | — |
| FR-051 | Clients list, search, investment filter | Implemented | Columns, search, project-investment filter | clients/queries.ts | clients-investments.test.ts | Filter tested | — | — |
| FR-052 | Client detail: investments, contracts / documents, payments, follow-ups, notes | Partially Implemented | All except contracts / documents (placeholder text) | clients/[id]/page.tsx | clients.test.ts | Placeholder 'Contract documents arrive with the client's templates' | Show the client's lead documents on the client page | Contract templates (Q-B5) for generated contracts only |
| FR-060 | Projects CRUD; inactive hidden from agents | Implemented | Type, status, company, location, description | projects/commands.ts | projects.test.ts | Selector filter tested | — | — |
| FR-061 | Per-project inventory dimensions | Implemented | Lists constrain unit fields | projects/commands.ts, inventory/commands.ts | inventory.test.ts | Out-of-list value refused | — | — |
| FR-062 | Project cards | Implemented | Type, status, units tracked, links | project-card.tsx | projects.test.ts | — | — | — |
| FR-070 | Unit fields | Implemented | All fields, unique unit no., audited, proposal price sync | inventory/commands.ts | inventory.test.ts | — | — | — |
| FR-071 | Statuses driven by bookings | Partially Implemented | Create → Reserved, Confirm → Booked, Cancel → Available | inventory/status.ts, bookings/commands.ts | inventory.test.ts, bookings.test.ts | No path to Sold; Partially booked never set | Booked → Sold trigger | Q-B4 |
| FR-072 | Sale models: whole, SPU, 50% | Blocked | Stored and filterable; booking refuses non-whole units | inventory/status.ts | inventory.test.ts | BUSINESS_RULE on SPU booking | Shares, pricing, partial status | Q-B1 |
| FR-073 | Inventory filters | Implemented | Search, project, status, nature, sale model | inventory/queries.ts | inventory.test.ts | All five tested | — | — |
| FR-074 | Unit detail with booking history | Implemented | Dimensions, status history, bookings | inventory/[id]/page.tsx | none | Page reads bookingsFor(unit) | Page test | — |
| FR-075 | Unit CSV import with validation report | Implemented | Check, then all-or-nothing import, audited | inventory/import.ts | unit-import.test.ts, inventory-import.spec.ts | 13 integration tests | — | — |
| FR-080 | New booking on Available unit; lead → Booking in Process | Implemented | Guarded unit claim, lead moved | bookings/commands.ts | bookings.test.ts | Concurrent claim tested | See F-1 | — |
| FR-081 | Hold from token; auto-release at expiry | Blocked | Reserved-until entered by hand; overdue flagged only | bookings/queries.ts | bookings.test.ts (flag) | No expiry job | Duration rule + release job | Q-B2 |
| FR-082 | Booking stages, logged, no invalid jumps | Implemented | One step forward; confirm / cancel by manager / admin | bookings/commands.ts, policy.ts | bookings.test.ts | Jump and concurrency tests | — | Q-B3 (stage rules are proposed defaults) |
| FR-083 | Overview incl. 30% milestone | Implemented | Total, paid / total, milestone, reserved until, agreement, docs status | bookings/[id]/page.tsx | finance.test.ts (30% boundary) | 'turns the 30% milestone on exactly at 30%' test | — | — |
| FR-084 | Printable Provisional receipt and Sales order | Blocked | Tabs show 'awaiting template' | bookings/[id]/page.tsx | none | Placeholder text | Print views, numbering | Q-B5 layout + C-21 numbering |
| FR-085 | Bookings list: search, project, stage | Implemented | Plus sorting and paging | bookings/queries.ts | bookings.test.ts, list-controls.spec.ts | — | — | — |
| FR-090 | Tasks with type, status, due, assignee, links | Implemented | CRUD, history, scopes | tasks/commands.ts | tasks.test.ts | — | — | C-30 (status list) |
| FR-091 | Proposal builder, cap, 36 default, print | Implemented | Total = area × rate; agent cap; editable rows; print page | tasks/plan.ts, app/print/proposal | tasks.test.ts, tasks-rules.test.ts | Cap and total tested | Floor map is CR-2 | — |
| FR-092 | Overdue tasks in To-dos | Implemented | Overdue tab | tasks/queries.ts | tasks.test.ts | — | — | — |
| FR-100 | Meetings with status and notes | Implemented | Create / edit / complete / cancel | meetings/commands.ts | meetings.test.ts | Concurrency test | Browser test | — |
| FR-101 | Completing a meeting can move lead to Meeting Done | Implemented | Ticked-by-default option, forward-only | meetings/commands.ts | meetings.test.ts | — | — | D1 rule unconfirmed |
| FR-102 | Meetings list filters | Implemented | Search, status, organizer, lead, overdue, sort | meetings/queries.ts | meetings.test.ts | 25 per page (FR-005) | — | — |
| FR-110 | Per-agent targets, daily / weekly / monthly | Implemented | Calls, meetings, sold sq ft; audited | targets/service.ts | teams-targets.test.ts | Scope tested | — | — |
| FR-111 | Achievement vs target | Partially Implemented | Meetings and sold sq ft computed; calls null | targets/service.ts | teams-targets.test.ts | 'calls unavailable' test | Calls % when a call source exists | C-19 |
| FR-120 | Teams with manager, members, active | Implemented | Inactive teams excluded from rotation | teams/commands.ts | teams-targets.test.ts | — | — | — |
| FR-121 | Daily report per team per date | Implemented | Unique per team/date, same-day edit, admin review | teams/commands.ts | teams-targets.test.ts | — | — | Q-H3 (manual values default) |
| FR-122 | Duty roster; Leads off skipped by rotation | Partially Implemented | Statuses, day / month views, 11:00 lock | teams/commands.ts | teams-targets.test.ts, questionnaire-screens.spec.ts | Rotation ignores roster | Skip 'Leads off' in rotation once confirmed | C-15 / TQ3 |
| FR-130 | My Workplace: leave, holidays, sign-ins | Implemented | Own data only, year selector | workspace/page.tsx | workplace.test.ts, leave.test.ts | — | — | — |
| FR-140 | Employee directory | Implemented | Records with or without login | employees/service.ts | employees.test.ts, questionnaire-screens.spec.ts | — | — | Q12 (fixed lists, low) |
| FR-141 | Holiday calendar, company and regional | Implemented | Team region filter in My Workplace | holidays/service.ts | holidays.test.ts, workplace.test.ts | — | — | C-3 (multi-team) |
| FR-142 | Leave: types, balance, approvals | Partially Implemented | Calendar days, medical from annual, over-balance blocked, overlap refused, balances, cancellation | leave/service.ts | leave.test.ts, leave.spec.ts | Staff requests can't be approved until approvers set; same person can approve both steps (F-6) | Require two different approvers | C-4, C-5, C-6, C-13 |
| FR-143 | Attendance | Blocked | Not built; screens say 'not available' | hr/page.tsx | none | — | Whole module | CR-1 (commercial) + C-16 |
| FR-150 | Agent KPI table | Partially Implemented | All columns except calls / call minutes ('—') | performance/service.ts | performance.test.ts | — | Calls if recordings count | C-19 |
| FR-151 | Performance charts | Partially Implemented | Outcome mix, top closers; call charts are placeholders | performance/page.tsx | performance.test.ts | — | Call charts | C-19 |
| FR-152 | Call quality buckets | Blocked | Duration stored, not aggregated | performance/page.tsx | none | — | Buckets | C-19 |
| FR-153 | Critical agent flag | Blocked | Disabled filter, 'rule not defined' | performance/page.tsx | none | — | Flag + thresholds | C-17 |
| FR-200 | Income records | Implemented | CRUD (void, no delete), attachments, audited, totals over all matches | finance/entries.ts | finance-entries.test.ts, finance-entries.spec.ts | — | — | Category lists (client data) |
| FR-201 | Expense records | Implemented | Same, with payee | finance/entries.ts | finance-entries.test.ts | — | — | — |
| FR-202 | Booking payments | Implemented | Locked booking row, no overpayment, receipt sequence, idempotent | finance/commands.ts | finance.test.ts, workflows.test.ts | Concurrency tested | — | C-24 (PDP / CDP types) |
| FR-203 | Outstanding and overdue vs schedule | Implemented | Net of reversals; overdue from payment plan | finance/views.ts | finance.test.ts | Partial, reversed, undated, timezone tests | — | C-27 (down-payment date) |
| FR-204 | Payment history per booking and client, receipt numbers | Implemented | Booking detail, client detail (all bookings), payments list | finance/queries.ts, clients/[id]/page.tsx:52 | finance.test.ts | — | Receipt code format | C-21 |
| FR-205 | Reports + CSV | Implemented | Collections, outstanding by project / agent, income vs expense; audited CSV | finance/reports.ts | finance-reports.test.ts, finance.spec.ts | Totals reconcile | See F-7 (reversal date) | — |
| FR-206 | No hard delete; reversals | Implemented | DB triggers block UPDATE / DELETE | drizzle/0005_finance_payments.sql | finance.test.ts | Trigger tests | — | Q31 (S-1) |

#### Non-functional requirements
| ID | Requirement | Status | Current implementation | Code | Tests | Evidence / gap | Remaining work | Dependency |
|---|---|---|---|---|---|---|---|---|
| NFR-01 | Up to 10 concurrent users | Partially Implemented | Pool of 10 connections | src/server/db/index.ts | none | Not load-tested | 10-user smoke test | — |
| NFR-02 | List pages < 1.5 s at 10k leads | Partially Implemented | Indexes on key columns | schema.ts | none | No load test | Seed 10k leads and time lists | — |
| NFR-03 | Business hours; daily backups | Blocked | backup.sh, restore-check.sh exist | scripts/ops | restore-check (test DB) | Not scheduled | Schedule on server | H-1, H-5 (production) |
| NFR-04 | Security | Implemented | Argon2id, hashed sessions, origin check, rate limit, headers, private files | src/server/* | security.test.ts, security-headers.spec.ts | — | Live checks on server | Production |
| NFR-05 | Chrome, Edge, Safari, mobile | Partially Implemented | Desktop Chrome + Chrome mobile emulation automated | playwright.config.ts | 72 browser tests | Edge / Safari / real phones untested | Manual cross-browser pass | Devices |
| NFR-06 | English, PKR, Asia/Karachi, UTC stored | Implemented | Formatting in Asia/Karachi | src/lib/format.ts | dashboard.test.ts, finance.test.ts | Timezone boundary test | — | — |
| NFR-07 | Source handover after final payment | Blocked | Process item | — | — | — | Hand over repository | Commercial (final payment) |

#### Questionnaire answers (exact answers in `CLIENT_ANSWERS_RECONCILIATION.md`)
| ID | Requirement | Status | Current implementation | Code | Tests | Evidence / gap | Remaining work | Dependency |
|---|---|---|---|---|---|---|---|---|
| Q1 | Records without login | Implemented | Nullable user link; linkable later | employees/service.ts | employees.test.ts, accounts.test.ts | — | — | C-6 (their leave) |
| Q2 | Admin / Super Admin manage accounts | Implemented | Create, role, reset, deactivate; SA-only for SA | accounts/service.ts | accounts.test.ts, accounts.spec.ts | — | — | C-1 (confirm) |
| Q3 | Manual disable with lead shift | Implemented | Admin chooses open / lost / booked groups | accounts/service.ts | accounts.test.ts | — | — | C-2 (confirm) |
| Q4 | Same allowance for all | Implemented | One setting, default 30 | leave/service.ts | leave.test.ts | — | — | C-7 (confirm 30) |
| Q5 | Holidays by team region | Partially Implemented | Team region filter | workplace/service.ts | workplace.test.ts | Multi-team rule open | — | C-3 |
| Q6 | 2-step approval | Blocked | Mechanism built; approvers not set | leave/service.ts | leave.test.ts | Requests stay pending | Set order; distinct approvers | C-4 |
| Q7 | Senior leave by Super Admin | Partially Implemented | Super Admin decides; no self-approval | leave/service.ts | leave.test.ts | — | One or two steps; SA's own leave | C-5 |
| Q8 | Calendar days | Implemented | Inclusive calendar days | leave/rules.ts | leave-rules.test.ts | — | — | — |
| Q9 | Team weekends | Implemented | Per-team weekend days on roster | teams | teams-targets.test.ts, questionnaire-screens.spec.ts | — | Attendance use (CR-1) | C-8 |
| Q10 | CPL = medical | Implemented | Label 'Medical (CPL)' | leave/rules.ts | leave.test.ts | — | — | C-9 (label, certificate) |
| Q11 | Medical from annual | Implemented | Single balance | leave/service.ts | leave.test.ts | — | — | — |
| Q12 | Over balance blocked | Implemented | Refused with remaining days | leave/service.ts | leave.test.ts, leave.spec.ts | — | — | — |
| Q13 | Prorate joiners | Partially Implemented | Provisional day-based method, flagged | leave/rules.ts | leave-rules.test.ts | — | Confirmed method | C-10 |
| Q14 | No carry-forward | Implemented | Calendar-year balances | leave/service.ts | leave.test.ts | — | — | C-11 (confirm Jan–Dec) |
| Q15 | Cancel approved leave via Admin / SA | Implemented | Request → decide, days returned, roster cleaned | leave/service.ts | leave.test.ts | — | — | C-12 (confirm details) |
| Q16 | Past-dated allowed | Implemented | — | leave/service.ts | leave.test.ts | — | — | — |
| Q17 | Cross-year deduction | Blocked | Held: recorded, not counted, not approvable | leave/service.ts, drizzle/0020 | leave.test.ts | — | Deduction rule | C-13 |
| Q18 | Approved leave on roster | Partially Implemented | First active team; never overwrites a manager entry | leave/service.ts | leave.test.ts | Bypasses the 11:00 lock for past days | Multi-team, overwrite rule | C-14 |
| Q19 | Rotation skips agents on leave | Implemented | Approved leave today excluded | leads/commands.ts | leave.test.ts | — | — | C-15 (Leads off, manual assign) |
| Q20 | Attendance wanted | Blocked | Not built | — | none | — | Module | CR-1 commercial |
| Q21 | Check-in / out, late, absences, hours, breaks | Blocked | Not built | — | none | — | Module | C-16 |
| Q22 | HR and Super Admin manage attendance | Blocked | Not built | — | none | — | Module | CR-1, C-16 |
| Q23 | Critical | Blocked | Not built | — | none | — | — | C-17 |
| Q24 | Open leads definition | Implemented | Open stages | leads/constants.ts | performance.test.ts | — | — | — |
| Q25 | Original assignment date | Partially Implemented | Date = original assignment; credit goes to current owner | performance/service.ts | performance.test.ts | Page footnote outdated | Attribute to the original assignee if confirmed | C-18 |
| Q26 | Completed meetings only | Implemented | — | performance/service.ts | performance.test.ts | — | — | — |
| Q27 | No manual call entry | Implemented | Calls 'not available' | performance/page.tsx | performance.test.ts | — | — | C-19 (recordings as calls?) |
| Q28 | Pipeline pressure | Blocked | Not built | — | none | — | Metric | C-20 |
| Q29 | Receipt code BH-GF/FF/SS-123 | Blocked | Prefix + sequence number | finance/queries.ts | finance.test.ts | — | Code format | C-21 |
| Q30 | Gaps allowed | Implemented | Sequence | finance/commands.ts | finance.test.ts | — | — | — |
| Q31 | Reversal approval Admin / SA only | Blocked | Manager still approves (access kept until signature) | finance/policy.ts | finance.test.ts | — | Remove manager | S-1 |
| Q32 | Refund after deduction | Blocked | Cancel blocked when paid | bookings/commands.ts | finance.test.ts | — | Refund workflow | C-22, CR-3 |
| Q33 | Methods + proofs | Implemented | Pay order added; proof attachments on payments | finance/proofs.ts | payment-proofs.test.ts, payment-proofs.spec.ts | — | Remove / replace a wrong proof (none today) | C-23 (mandatory?) |
| Q34 | PDP / CDP | Blocked | Not defined | — | none | — | Types / stages | C-24 |
| Q35 | Overpayment blocked | Implemented | In locked transaction | finance/commands.ts | finance.test.ts | — | — | — |
| Q36 | Only Super Admin edits proposals | Blocked | Unchanged (access kept) | tasks/policy.ts | tasks.test.ts | — | Restrict editing | S-1, C-25 |
| Q37 | Remainder on last installment | Implemented | — | tasks/plan.ts | tasks-rules.test.ts | — | — | — |
| Q38 | Default discount 0% | Implemented | — | tasks/validation.ts | tasks.test.ts | — | — | — |
| Q39 | Save with warning | Implemented | Client-side warning | task-form.tsx | none | — | Test | — |
| Q40 | Agent cap 5% | Implemented | Seeded | tasks/constants.ts | tasks.test.ts | — | — | — |
| Q41 | Manager cap 5% | Implemented | Migration 0014 | drizzle/0014 | tasks.test.ts | — | — | — |
| Q42 | Down payment 25% | Implemented | Default 25%, 36 installments kept | tasks/constants.ts | tasks.test.ts | — | — | C-26 (installments) |
| Q43 | Installments on the 10th | Partially Implemented | Dated rows from a chosen first month; down payment undated | tasks/plan.ts | tasks.test.ts, questionnaire-screens.spec.ts | — | First-month and down-payment rule | C-27 |
| Q44 | Floor prices GF / FF / SF + ROI | Blocked | One global price setting, unit prices used | tasks/settings.ts | none | — | Floor pricing | C-28 |
| Q45 | Admin / SA assign to all | Partially Implemented | Admins assign to everyone incl. HR / Accountant; others still assign in scope | tasks/policy.ts | tasks.test.ts | — | Removal half | S-1, C-29 |
| Q46 | Task status list | Blocked | Statuses unchanged | tasks/constants.ts | none | — | — | C-30 |
| Q47 | Proposals reflect unit changes | Implemented | Auto-sync + reconciliation | tasks/price-sync.ts | tasks.test.ts | — | — | C-31 (printed copy?) |
| Q48 | Only Available units | Implemented | Picker and server | tasks/commands.ts | tasks.test.ts, questionnaire-screens.spec.ts | — | — | — |
| Q49 | Floor map on print | Blocked | Not built | — | none | — | CR-2 | Plan images + CR-2 approval |
| Q50 | Sign-in log deletion | Blocked | 12-month setting, deletion off, dry-run job | security/service.ts | security.test.ts | — | Turn on after dry run | S-1 + scheduler |
| Q51 | Sign-ins = authentication only | Implemented | — | workplace/service.ts | workplace.test.ts | — | — | — |
| Q52 | Playback: Manager, Admin, SA | Blocked | Owner agent can still play (access kept) | files/lead-files.ts | recordings.test.ts | — | Remove agent playback | S-1, C-32 |
| Q53 | Lifetime retention, SA delete | Partially Implemented | Kept; Super Admin hides (file kept), audited | files/lead-files.ts | recordings.test.ts | — | Permanent erase if wanted | C-33 |

#### Quotation feature lines → rows
- **Dashboard:**
  - Sales overview / statistics / source reports / charts: FR-010 – 013, FR-016.
  - Recent leads: FR-015.
  - Notifications & follow-up alerts: FR-006.
- **Leads:** FR-020 – 038, FR-042 (lead history: FR-025).
- **Clients:** FR-050 – 052, FR-204.
- **Projects:** FR-060 – 062.
- **Inventory:** FR-070 – 075.
- **Bookings:**
  - Create / unit selection: FR-080.
  - Token & hold: FR-081.
  - Status: FR-082.
  - Payment tracking: FR-083, FR-202.
  - Receipts & sales order: FR-084.
- **Tasks:** FR-090 – 092.
- **Meetings:** FR-100 – 102.
- **Targets:** FR-110 – 111.
- **Teams:**
  - Team management / members: FR-120.
  - Performance: FR-120 – 121.
  - Daily reports: FR-121.
  - Duty roster: FR-122.
- **HR:**
  - Employee records: FR-140.
  - Holidays: FR-141.
  - Leave requests, approvals and balances: FR-142.
- **My Workplace:** FR-130.
- **Performance:**
  - Agent performance, lead conversion, calls & follow-ups, meetings: FR-150.
  - Attendance: FR-143.
  - Charts: FR-151.
- **Accounts & Finance:** FR-200 – 206.

#### Findings (checked in code)
| # | Severity | Finding | Where |
|---|---|---|---|
| F-1 | **High** | A lead in "Booking in Process" with an active booking can still be moved to another stage or marked Lost. The unit stays Reserved and the booking stays open, so the lead and the booking disagree. Only Booked leads are protected. | `leads/commands.ts` changeStage :299, markLost :450; `leads/rules.ts` |
| F-2 | Medium | Pending follow-ups of Lost or Booked leads stay in To-dos (Today, Overdue) and in reminders. Losing a lead does not close them, and the buckets have no stage filter. | `leads/queries.ts` :343–366 |
| F-3 | Medium | Editing a lead's phone number skips the duplicate check. | `leads/commands.ts` updateLead |
| F-4 | Medium | Audit-log gaps: lead notes, follow-ups, reviews and favourites, and client notes and follow-ups, write no audit row. The audit row's IP is never stored. There is no admin view of the audit log (SECURITY_AND_PRIVACY §3). | `leads/commands.ts`, `clients/commands.ts` |
| F-5 | Medium | Lists below 50 per page: meetings, tasks, performance and sign-in log (25), notifications (20), projects (24). Projects and teams can't be sorted (FR-005). | `*/constants.ts` |
| F-6 | Medium | One person can approve both leave steps when both steps are the same role, for example two Admin steps. | `leave/service.ts` :198–255 |
| F-7 | Low–Medium | A reversal takes the original payment's date, so a later reversal changes an earlier month's collections and doesn't appear in the month it happened. Which date should count is a finance decision (D-F1). | `finance/commands.ts` :165, `finance/reports.ts` :54 |
| F-8 | Low | Leave approved for past days writes roster days that are already locked (after 11:00). The roster keeps one entry per person per day, so a member in two teams overwrites the other team's entry. | `leave/service.ts` :220, `teams/commands.ts` :342 |
| F-9 | Low | The Performance page footnote still describes counting by creation date. Credit goes to the current owner on the original assignment date (C-18). | `performance/page.tsx` :214 |
| F-10 | Low | A wrong password on an inactive account says "This account is inactive", which reveals that the account exists. The login rate limit is kept in memory and resets on restart. | `auth/login.ts` :42–47, `auth/rate-limit.ts` |
| F-11 | Low | The finance CSV export falls back to "collections" for an unknown report name. Payment proofs can't be removed or replaced. | `finance/reports.ts`, `finance/proofs.ts` |
| F-12 | Docs | This file, §12.2 Q17, says cross-year leave is "refused"; the code holds it (corrected in §13.1). `PRODUCTION_HANDOVER_CHECKLIST.md` and §4 above still say "13 migrations / 0000–0012"; there are 22. | docs |

### 17.C Remaining development work (agreed, no client decision needed)
| # | Item | Rows | Estimate |
|---|---|---|---|
| 1 | Block lead stage moves and Lost while the lead has an active (not cancelled) booking: "managed from the booking", like Booked leads (F-1) | FR-021, FR-080 | 0.5 d |
| 2 | Leave closed leads' follow-ups out of To-dos and reminders (F-2) | FR-027 | 0.25 d |
| 3 | Duplicate check when a phone is edited (F-3) | FR-031 | 0.25 d |
| 4 | Audit rows for the missing commands; store the IP; an Admin / Super Admin audit-log view with filters (F-4) | FR-008 | 1 d |
| 5 | 50 per page and sorting on the remaining lists (F-5) | FR-005 | 0.5 d |
| 6 | Require two different people for two-step leave approval (F-6). The approval order itself stays C-4. | FR-142 | 0.25 d |
| 7 | City "Other" with a validated free-text city | FR-042 | 0.5 d |
| 8 | Remember the active project per user, not only per device | FR-004 | 0.25 d |
| 9 | Client page: list the client's lead documents (contract templates stay with Q-B5) | FR-052 | 0.25 d |
| 10 | Small fixes: Performance footnote (F-9), generic sign-in message (F-10), export report validation (F-11), stale docs (F-12) | — | 0.25 d |
| 11 | Missing tests: browser tests for booking create / advance / cancel, meetings, targets, daily reports and task pages; API-level 403 tests for the reports export, leave and performance routes; to-do bucket parity; pipeline filters | — | 1.5 d |
| 12 | NFR checks: 10k-lead timing (NFR-02) and a 10-user smoke test (NFR-01) | NFR-01, 02 | 0.5 d |
| | **Total** | | **≈ 6–6.5 developer-days (45–50 h)** |

### 17.D Client decisions and dependencies
| ID | Decision needed | Why the build depends on it | Rows |
|---|---|---|---|
| S-1 | Sign and date the questionnaire | Required before any access is removed (Q31, Q36, Q45, Q52) and before sign-in log deletion (Q50) | Q31, Q36, Q45, Q50, Q52 |
| C-1 | May an Admin manage a Super Admin account? | Today only a Super Admin can | Q2 |
| C-2 | Which leads (and follow-ups, tasks, meetings) move on deactivation | Defines the shift | Q3 |
| C-3 | Region and weekend for a person in several teams | Two teams can give two answers | Q5, Q9, FR-141 |
| C-4 | Who approves leave first and second; what happens without a manager | No staff request can be approved until set | Q6, FR-142 |
| C-5 | Senior leave: one step? Who approves a Super Admin's own leave? | Self-approval is blocked | Q7 |
| C-6 | Leave for staff without a login | They can't submit | Q1, FR-142 |
| C-7 | Confirm 30 days | Allowance value | Q4 |
| C-8 | What team weekends are used for | Roster only vs attendance | Q9 |
| C-9 | "Medical" label; certificate? | Form and labels | Q10 |
| C-10 | Proration method and rounding | Joiners' balances (provisional now) | Q13 |
| C-11 | Leave year Jan–Dec? | Balance reset | Q14 |
| C-12 | Cancellation details | Confirms the flow built | Q15 |
| C-13 | Cross-year deduction: split, or old year | Held requests can't be approved | Q17 |
| C-14 | Leave vs a manager's roster entry; several teams | Roster writing | Q18 |
| C-15 | Does "Leads off" skip rotation? Block or warn when assigning to someone on leave? | Rotation rules | Q19, FR-122 |
| C-16 | Attendance capture, hours, lateness, breaks, absence, self-view | Attendance can't be designed | Q20–Q22, FR-143 |
| CR-1 | Commercial decision on attendance (quoted as one Performance line; the answers describe a full module, 6–9 d) | Scope and price | FR-143 |
| C-17 | Critical: an agent or a lead, and the thresholds | No rule | Q23, FR-153 |
| C-18 | Original assignment: is the original assignee credited? | Performance attribution | Q25 |
| C-19 | Does each uploaded recording count as a call? | Calls in performance, targets and call quality | Q27, FR-111, FR-150 – 152 |
| C-20 | Pipeline pressure formula and period | No formula | Q28 |
| C-21 | Receipt code: BH, floor codes (SS vs SF), restart rule, reversals | Printed on legal documents | Q29, FR-084, FR-204 |
| C-22 / CR-3 | Refund deduction: who decides and approves; income treatment; unit release | Paid bookings can't be cancelled today | Q32 |
| C-23 | Is a payment proof mandatory? | Proofs are optional now | Q33 |
| C-24 | What PDP and CDP mean | Payment types and stages | Q34 |
| C-25 | May proposal owners fix a proposal before printing? | Proposal locking | Q36 |
| C-26 | Keep 36 installments? | Default count | Q42 |
| C-27 | First installment month; down-payment due date | Generated dates; overdue on the down payment | Q43, FR-203 |
| C-28 | Floor prices: which projects, override or fill, ROI rate | Proposal prices | Q44, FR-009 |
| C-29 | Can agents and managers still create their own tasks? | Assignment policy | Q45 |
| C-30 | Task types vs statuses; full list | Overdue logic depends on statuses | Q46, FR-090 |
| C-31 | Keep a copy of what was printed? | Price disputes | Q47 |
| C-32 | Agents upload but can't play their own recordings? | Removes access | Q52 |
| C-33 | Recording delete: erase, or hide | Irreversible | Q53 |
| CR-2 | Floor map on proposals (plan images, change request) | Assets + scope | Q49 |
| Q-B1 | SPU / 50% shares: sizing, pricing, Sold | Share bookings | FR-072 |
| Q-B2 | Token amount → hold duration; auto-release | Holds never expire today | FR-081 |
| Q-B3 / Q-B4 | Mandatory stages; when Booked becomes Sold | Unit status lifecycle | FR-071, FR-082 |
| Q-B5 | Provisional receipt and Sales order templates | Print views | FR-084, FR-052 |
| D-F1 | Date a reversal counts in collections: original date or reversal date (F-7) | Monthly figures | FR-205 |
| M-Q1 – M-Q5 | Aging matrix definitions | No definition | FR-014 |
| Merge 1–6 | Shared-phone merge rules | Merge is irreversible | FR-032 |
| Q-L7 | Who may delete leads (soft delete) | No deletion today | Leads |
| Q-P5 | SaleStorm export sample and mapping | Lead import | FR-043 |
| N2 – N6 | Further notification events; email or push | Only 5 events exist | FR-006 |
| D1 | Owner in several teams on the dashboard | Lost-by-team count | FR-016 |
| Q12, TQ2 – TQ8, Q-H3 | Fixed department lists; roster and report details; daily-report values manual | Defaults in use | FR-121, FR-140 |
| **Production** | H-1 – H-12: server, SSH, domain / DNS, database, backup destination, first Super Admin, users, lookup lists, company details, CDN, maintainer | Deployment and handover | NFR-03 |

**Excluded integrations, not unfinished work:**
- AI call analysis (FR-039), Meta (FR-040) and TikTok (FR-041) lead ads;
- WhatsApp, email and SMS;
- telephony, payment gateways, bank integrations and maps.

The quotation excludes these unless they are quoted separately.

### 17.E Production deployment checklist (before handover)
1. Client supplies H-1 – H-5 and H-11 (server, SSH, domain / DNS, database, backup destination, CDN).
2. Client supplies H-6 – H-10 (first Super Admin, users, lookup lists, company details).
3. Write the P3 runbook (systemd unit, update and rollback, log location) and the P4 administrator guide. Fix the stale migration counts.
4. Harden scripts:
   - `db-seed` must refuse any database that isn't a development one, not only when `NODE_ENV=production`;
   - never ship `.env.local`;
   - fail at startup in production if `FILE_STORAGE_DIR` is missing.
5. Run and record the P5 clean-install rehearsal on the test database.
6. Freeze the release commit: typecheck, lint, Vitest, Playwright (idle machine), drift check and build.
7. Server hardening: firewall 22 / 80 / 443, key-only SSH, app user, UTC, automatic security updates.
8. Production database and role. Fresh secrets. Env file mode 600, without `TEST_DATABASE_URL`.
9. File-storage volume, mode 700, outside the app folder.
10. Caddy: TLS, a request body cap, and no duplicate headers.
11. `npm ci`, `npm run build`, `npm run db:migrate`, then start the systemd service.
12. P1 setup with `--confirm-database` and the approved lookups. The client types the Super Admin password.
13. Client creates users and teams and sets the settings: reminder minutes, approval steps, price and ROI if known.
14. Confirm that no development account or demo project exists.
15. Live checks:
    - headers;
    - real IP, and a spoofed forwarded header ignored;
    - app port closed;
    - upload and playback over HTTPS;
    - login rate limit;
    - a spot-check for each role.
16. Schedule sign-in log pruning (deletion off) and run one `--dry-run`.
17. Nightly backup (database + files) to an off-server destination, with retention and a failure alert. Take the first backup and check it.
18. Run the restore check on the server and record the row counts.
19. Client acceptance testing on desktop and phone (`PRODUCTION_HANDOVER_CHECKLIST.md` §8–§9). Close severity 1–2 defects.
20. Hand over the runbook, the administrator guide and the list of deferred and excluded items. Get written acceptance. Rotate any secrets Zeploy Tech held.

**Production readiness by area:**
- **Ready:** authentication and authorization, upload security, migrations and P1 setup (client lists still needed), env template.
- **Partially ready:** HTTPS / server configuration (no unit file, live checks never run), backups (no pruning, alert or encryption), restore (rehearsed only on the test database), error logging (stdout only), removal of development accounts (the seed guard depends on `NODE_ENV` alone), build and deployment (P3 and P4 missing).
- **Not ready:** live environment testing.

### 17.F Test and quality assessment
- **Latest verified results (round 6, 3 Nov 2026):**
  - typecheck: pass;
  - lint: 0 problems;
  - Vitest: 46 files, 426 / 426;
  - Playwright: 72 / 72 in three consecutive full runs on an idle machine;
  - build: 101 / 101 pages;
  - 22 additive migrations, no drift.
- **What the tests prove:** most integration tests check real behaviour against a PostgreSQL test database: permissions per role, concurrency (payments, unit claims, stage moves), database triggers (payment immutability), calculations against ledger rows, and audit rows. Browser tests drive the production build with real sign-in.
- **Gaps:**
  - no browser tests for creating, advancing or cancelling a booking, or for meetings, targets, daily reports and task pages;
  - no API-level 403 tests for the finance export, leave or performance routes (the services are tested);
  - to-do bucket parity is tested for one bucket only;
  - pipeline filters beyond stage and priority are untested;
  - the review feed's positive path is untested;
  - unit detail and printed proposal output are untested;
  - NFR-01 / NFR-02 have no load or concurrency tests;
  - Edge, Safari and real phones are untested;
  - the shared-phone test only asserts that there are zero groups.
- **Weak spots:** a few tests assert only that something is refused, not the positive path (reviews, shared phones). Some Q-rules are covered only by unit tests of the rules module, not end to end (the Q39 warning).

### 17.G Recommended implementation order
1. **F-1, the booking ↔ lead integrity guard.** It's data integrity, small and high impact.
2. **F-2 and F-3**, to-do and duplicate correctness. Users see wrong lists today.
3. **F-6**, the two-person leave approval. It's a control weakness.
4. **F-4**, audit completeness and the audit-log view, needed before production data exists.
5. **Production hardening in code**: the seed guard, the storage startup check and the sign-in message.
6. **F-5, FR-042, FR-004, FR-052**: consistency and small gaps.
7. **The missing tests and the NFR timing checks.**
8. **P3, P4 and the P5 rehearsal.** Then deployment once H-1 – H-12 arrive.
9. **Client-dependent work, in this order once answered:**
   - S-1 access removals (small);
   - C-4 / C-13 / C-10 leave;
   - C-21 + Q-B5 receipts and sales order;
   - Q-B2 hold expiry;
   - C-27 / C-28 proposals;
   - C-19 calls;
   - C-17 / C-20 metrics;
   - Q-B1 shares;
   - Merge and Q-L7;
   - Q-P5 import;
   - CR-3, CR-2 and CR-1 if approved and quoted.

### 17.H Completion estimate
**How it's calculated:** the 82 in-scope functional rows (85 minus the 3 excluded integrations). Implemented counts 1, Partially Implemented counts 0.5, Blocked counts 0: (60 + 13 × 0.5) / 82 = **81 %**.

This ignores how big each item is. Most Blocked rows are small once the client decides; attendance (CR-1) is the exception. By effort, the agreed build is about 93–95 % done.

| Bucket | Remaining |
|---|---|
| **Agreed development** (§17.C) | **≈ 6–6.5 developer-days** |
| **Client-dependent**, once decided | ≈ 8–12 developer-days without change requests: <br>- leave decisions 1–1.5 d<br>- receipts / sales order + code 2 d<br>- hold expiry 1 d<br>- SPU shares 2–3 d<br>- calls from recordings 1 d<br>- Critical + Pipeline pressure 1–1.5 d<br>- aging matrix 1 d<br>- merge 1.5 d<br>- lead import 1–2 d<br>- floor prices 0.5–1 d<br>- task statuses 0.5–1 d<br>- S-1 removals 0.5 d<br>- recording erase 0.25 d<br><br>Change requests on top: CR-1 attendance 6–9 d, CR-2 floor map 3–4 d, CR-3 refunds 3–5 d. |
| **External integrations** | Not in scope. Quoted separately on request (AI, Meta, TikTok, WhatsApp, email, SMS). |
| **Deployment and handover** | ≈ 1.5 d preparation (P3, P4, P5, script hardening), plus 1 d deployment, live checks and backup / restore on the server once H-1 – H-12 are provided, plus client acceptance time. |


## 18. F-1 fixed: a lead's stage follows its open booking (3 Nov 2026)

**Root cause.** Creating a booking moves the lead to Booking in Process, but the Leads paths only protected **Booked** leads. A lead with an open booking (any stage except Confirmed or Cancelled) could still be marked Lost, or moved to any stage through the pipeline or stage menu. Approving an agent's earlier lost request didn't check either. The unit then stayed Reserved and the booking open while the lead said otherwise.

**Rule applied (existing rules, nothing new):** "managed from the booking", the rule that already covers Booked leads, now also covers a lead with an open booking. To mark it Lost or move it, cancel the booking first; that releases the unit, as before. Nothing is cancelled automatically, and no cancellation rule changed.

**Where it is enforced:**
- `leads/commands.ts`:
  - `changeStage`: only a move back to Booking in Process is allowed;
  - `markLost`: direct, and the agent request;
  - `decideLostRequest`: approval is refused and the request stays pending (it can still be rejected).
- `meetings/commands.ts` `moveLeadForward`: the meeting is saved, the lead isn't moved.
- `bookings/commands.ts` `setLeadStage`: re-checks the lead after locking it. If it became Lost meanwhile, the whole booking, including the unit claim, rolls back.
- Migration **0022** (additive): trigger `leads_stage_follows_open_booking` refuses the same change from any other writer. No existing row changed. Development data was checked first and had no inconsistent lead.

**Concurrency:** every path locks the lead row, then checks for open bookings. Booking creation re-checks under the same lock, so a concurrent Lost and booking can't both succeed.

**Tests:**
- `bookings.test.ts` "F-1", 9 tests:
  - Lost direct, request and approval refused;
  - every other stage refused;
  - meetings don't move the lead;
  - the database trigger;
  - free moves without a booking;
  - cancel → unit Available → Lost allowed → unit bookable again;
  - confirmed leads still locked;
  - concurrent Lost vs booking and concurrent move vs booking, 6 rounds each.
- `e2e/booking-lead-stage.spec.ts`:
  - Mark lost refused on the lead page, and the pipeline drag refused, both with the explanation;
  - cancel the booking in the UI, then the unit is Available and the lead can be marked lost.

**Verification:**

| Check | Result |
|---|---|
| Typecheck, lint | Pass |
| Vitest | 46 files, 435 / 435 |
| `bookings.test.ts` alone | 21 / 21, three runs |
| Schema drift | Clean (23 migrations) |
| Build | 101 / 101 pages |
| Playwright full suite | 73 / 73 |

The first full Vitest run had 20 timeouts at about 10 s, starting mid-file and continuing into later files. The test database showed no stuck session afterwards, and the next full run passed 435 / 435. This is the same intermittent database stall noted in §16.6, still unexplained.

## 19. F-2 fixed: Lost leads leave To-dos and reminders (3 Nov 2026)

**Root cause.** Every reader of pending follow-ups filtered on the follow-up's own status (`pending`) and never on the lead's stage. Marking a lead Lost doesn't touch its follow-ups (by design: they are history). So a Lost lead's follow-ups stayed in To-dos, in the follow-up window filter, and in reminders.

**Rule (no new business rule):** a pending follow-up is active work only while its lead isn't Lost. The source of truth is `leads.stage`. One shared condition, `followUpLeadActive()` in `leads/support.ts`, is used by every reader:

| Reader | Change |
|---|---|
| `leadTodos` (To-dos, every pending bucket: Today, Tomorrow, 7 / 15 / 30 days, Overdue) | Lists and counts both exclude Lost leads. "Done today" (history) is unchanged. |
| Leads list / pipeline "follow-up window" filter | Excludes Lost leads; the Lost view itself is unchanged |
| `syncFollowUpReminders` (reminder creation, run on every notifications read; there is no separate job) | No reminder for a Lost lead |
| Notification list → bell pop-up | A reminder created **before** the lead was lost stays listed (history) but doesn't pop up (`popup: false`) |

**Not changed:**
- **Follow-up records:** they stay pending, with the same times and notes.
- **Notification rows** are not modified.
- **The lead page** still lists the follow-ups.
- **Performance follow-up %** is a historical KPI; changing its definition would be a business rule.
- **Permissions, sorting, filters and paging** are as before.

**Restoring a lead:** moving a Lost lead back to an active stage restores its follow-ups in To-dos and reminders, because nothing was deleted. An agent's lost request keeps the follow-ups active until a manager approves it.

**Tests:**
- `leads.test.ts` "F-2", 4 tests:
  - Today and Overdue lists and counts, before and after Lost, with history untouched;
  - the agent's request, then approval;
  - restore;
  - the follow-up filter vs the Lost view.
- `notifications.test.ts` "F-2", 2 tests:
  - no reminder for a Lost lead, active leads still reminded, restore reminds again;
  - an earlier reminder is kept but doesn't pop up, and pops up again after restore.
- `e2e/todos-lost-leads.spec.ts`: overdue follow-up in To-dos → mark lost → gone (still on the lead page) → move back to Contacted → back in Overdue.

**Verification:**

| Check | Result |
|---|---|
| Typecheck, lint | Pass |
| Vitest | 46 files, 441 / 441 |
| Schema drift | Clean (no migration for F-2) |
| Build | 101 / 101 pages |
| Playwright full suite | 74 / 74 |

## 20. F-3 fixed: duplicate phone check when a lead's phone is edited (4 Nov 2026)

**Root cause.** `createLead` ran the duplicate rule, but `updateLead` only normalized a new phone and saved it, without looking for another lead with that number. Separately, nothing serialized two requests claiming the same number. Even creation could race: two simultaneous creates could both pass the check.

**Rule (unchanged, LEADS_MODULE_PLAN Q1).** A match is the earliest lead in the **same project** with the same normalized number, not deleted, and not itself a flagged duplicate. Normalization is the existing `phoneOrThrow` / `normalizePhone`, so "0300-1234567", "+92 300 1234567" and "0092 3001234567" are the same number.

**What changed (`leads/commands.ts` only):**
- **One shared helper, used by both flows.** `findPhoneMatch()` is the rule; create uses it as before, and edit uses it with the edited lead excluded. `duplicatePhoneError()` gives both the same message: "A lead with this phone number already exists in this project."
  - On edit, the error is also attached to the Mobile number field: "Already used by lead <code>", or "…by another lead in this project" when the editor can't see that lead.
  - Nothing about a hidden lead is revealed.
- **The check runs only when the normalized number actually changes.** Keeping the number in a different format, or editing a flagged duplicate's other fields, behaves exactly as before.
- **Concurrency: `lockPhone()`.** A transaction-scoped database lock on project + number is taken in both create and edit before the check, so simultaneous claims of one number are serialized. On edit it is taken before the lead's row lock, the same order create uses when it regenerates a lead, so the two can't deadlock.

**No schema change, and why.** The only phone index is a lookup index. A unique index can't be added, because flagged duplicates and shared-phone groups (FR-032) legitimately share a number. Development data checked: 0 shared-phone groups and 0 flagged duplicates.

**Kept as before:** permissions, which are checked before the phone check (other teams' leads → 404, HR → 403); the `lead.update` audit row and timeline entry (nothing is written on a refusal); and every other field.

**Tests:**
- `leads.test.ts` "F-3", 7 tests:
  - unchanged number in another format, including a flagged duplicate;
  - unused number saved, normalized, audited and on the timeline;
  - taken number refused in 5 formats plus a separate country code, with nothing written;
  - another project or a deleted lead allowed;
  - hidden lead not revealed, permissions unchanged;
  - concurrent edits for one number (6 rounds);
  - edit vs create race (4 rounds), and creation's own duplicate handling.
- **The race tests were checked to be meaningful.** With the lock temporarily disabled, both failed; with it they pass.
- `e2e/lead-phone-edit.spec.ts` (desktop and mobile):
  - the taken number written as "+92 …" is refused, with the message and the field error, and nothing is saved;
  - a new number then saves normalized and audited.

**Outside F-3, needed for the suite to pass.** `e2e/leave.spec.ts` checked the live day count with a substring match. From 4 Nov, "52 calendar days" (dates lost to a late page load, then 4 Nov → 25 Dec) satisfied a check for "2 calendar days", and the mobile run then hit an overlap. The match is now exact, so the existing retry refills the dates.

**Verification:**

| Check | Result |
|---|---|
| Typecheck, lint | Pass |
| `leads.test.ts` | 29 / 29 |
| Vitest full | First run: about ten leave and holiday tests hit the 10 s stall seen before (§16.6, §18). The re-run, with a once-a-second database lock sampler, passed **46 files, 448 / 448** and saw no blocked or idle-in-transaction session. The cause is still unidentified. |
| Schema drift | Clean (23 migrations, none new) |
| Build | 101 / 101 pages |
| Playwright full | **76 / 76** after the leave spec fix (the first run was 75 / 76) |

## 21. F-6 fixed: two-step staff leave needs two different approvers (4 Nov 2026)

Requested as "F-4"; in the §17 findings table this is **F-6** (F-4 there is the audit-log gaps, not started).

**Root cause.** `canDecideStep` checked only the step's approver **role**: step 1 against `leave.staff_step1`, step 2 against `leave.staff_step2`. It never looked at who decided step 1. When both steps resolve to the same role (HR / HR, Admin / Admin, team manager / team manager), the step 1 approver passed the step 2 check and could complete the request alone. The request row lock serialized decisions but didn't stop the same person deciding twice in a row.

**What changed:**
- **Service (`leave/service.ts`).**
  - `canDecideStep` now refuses step 2 to whoever approved step 1, read from `leave_decisions`. This applies to approving and to rejecting step 2.
  - `decideLeave` refuses with **"You approved step 1 of this request. Step 2 needs a different approver."** (403).
  - The "Waiting for your decision" queue uses the same check, so the request is offered only to someone else.
- **Database (migration `0023`, additive).** A partial unique index, `leave_decisions_one_approval_per_actor_uq` on (request, actor) where kind = 'approval'. It is the backstop for any other writer. `decideLeave` maps a violation to the same message. Before the index was added, the dev and test databases had no leave decisions, so no row conflicts.
- **Concurrency.** Decisions still lock the request row first. A second simultaneous attempt by the same person waits, then sees step 1 already recorded as theirs and is refused. If anything bypassed the service, the index would refuse it.

**Unchanged:**
- **Approval rules.** The step roles and order (still unset, waiting for C-4, so staff requests stay pending with the notice) and senior leave (one step, Super Admin only; Admins can't).
- **Refusals.** Self-approval, and decided or held cross-year requests.
- **Balances, roster and audit.** Balances; roster writing on final approval; cancellation; the `leave.approve_step` / `leave.approve` / `leave.reject` audit rows.
- **No new rules.** No staff approval order was invented, and the settings form still accepts the same role for both steps. Two different people in that role are now required.

**Recorded approvers.** Each step already wrote a `leave_decisions` row with step, approver, decision, comment and time. Both rows are now guaranteed to have different approvers.

**Tests:**
- `leave.test.ts` "F-6", 9 tests:
  - **Same role at both steps:**
    - HR / HR: the step 1 approver is refused at step 2, both approve and reject. Nothing changes: still step 2, days held, no roster. The request isn't in their queue; it is in a second HR user's. That user completes it, and both approvers, times, audit rows, roster days and balance are checked.
    - Admin / Admin, completed by a Super Admin.
    - Team manager / team manager, completed by the agent's other team manager.
  - **Unchanged behaviour:**
    - different roles per step, with unauthorised users and the requester refused and a decided request staying decided;
    - rejection at step 1 or 2;
    - the Super Admin single-step path and its self-approval refusal.
  - **Concurrency:**
    - the same person approving twice at once (6 rounds): one step 1, one refusal;
    - two different approvers at once (4 rounds): one decision per step, two people.
  - **The database index** refuses a second approval row by the same person.
- **Checked to be meaningful.** With the service check removed, the database index still refused the second approval with the same message. Only the queue test failed, so both layers work independently.
- `e2e/leave-two-step.spec.ts` (desktop):
  - Admin / Admin is set for the test and cleared afterwards. An agent requests leave, and the Admin approves step 1 in one tab.
  - The same Admin's second, stale tab tries step 2 and gets the message; after a reload, the request is gone from their queue.
  - The Super Admin completes step 2, and the database shows two different approvers.
  - Run 8 times in a row: 8 / 8.

**Verification:**

| Check | Result |
|---|---|
| Typecheck, lint | Pass |
| `leave.test.ts` | 24 / 24 |
| Vitest full | **46 files, 457 / 457** (idle machine), and again 457 / 457 under heavy CPU load (below) |
| Schema drift | Clean (24 migrations; `0023` applied to development and test) |
| Build | 101 / 101 pages |
| Playwright full | **77 / 77** |

**The recurring Vitest stall (investigated separately; not reproduced).** Timeouts were not raised and no retries were added.
- **Run 1 (idle machine):** a once-a-second sampler of the test database's sessions recorded any query running over 3 s, any idle-in-transaction session over 3 s, and any blocked session. Nothing slow; at most 4 connections at once, so no leaked pools between files.
- **Run 2 (heavy load):** two production builds and a typecheck ran alongside. 457 / 457 passed in 401 s. The sampler saw only sub-second lock waits from the concurrency tests themselves.
- **What this rules out:**
  - CPU load alone;
  - leaked connections;
  - a long-held lock inside the suite;
  - an outside process on the test database (none was connected; the only other Node process was an unrelated Vite server on port 5500).
- **Still open.** The failures (§16.6, §18, §20) were all on the first full run after a change, all ~10 s hook timeouts that carried over into later files. Next time it happens, run the same sampler during the failing run. That would capture what the stuck `beforeEach` (truncate and fixture seeding) is waiting on.

**Remaining risks:**
- **No second person, no approval.** With the same role at both steps and only one person in that role (for example a single HR user), staff requests can't complete; they stay pending, visibly. That's the intended consequence of "two different people", but the C-4 decision should name roles with at least two people, or two different roles.
- **The step 1 approver can't reject step 2 either.** That follows "two different people decide the two steps". If the client wants the first approver to be able to withdraw their approval, that's a new rule (not added).
- **Deleted approvers.** A decision whose approver account is later deleted keeps `actor_id` null, so the index can't compare it. Users are deactivated, not deleted, in the app, so this is theoretical.
