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
| FR-043 / FR-075 CSV imports | — | Q-P5 |
| FR-081 holds | — | Q-B2 |
| FR-084 receipts / sales order | — | Q-B5 |
| FR-142 leave | — | Q3 etc. |
| FR-152 call quality | Durations are now stored | Q: "does a recording count as a call" |
| FR-153 critical flag | — | Q-L8 |
| FR-200 / 201 / 205 income and expense | — | Q-F |
| FR-203 overdue vs schedule | — | Schedules |
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
