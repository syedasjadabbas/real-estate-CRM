# My Workplace — module plan

Status: **Upcoming holidays and Sign-in history built and verified, 30 Oct 2026 (§8).** My leaves stays pending until the HR leave questions are answered.
W1–W4 were approved by the user as proposed in §3.1.

Sources read:
- `REQUIREMENTS.md` FR-130, FR-002, FR-141, FR-143.
- `MODULES_AND_FEATURES.md` §11 My Workplace.
- `HR_MODULE_PLAN.md` §1.1 (reference UI), §5 (permissions), §9 (client questions), §12 (Holidays), §14 (Employee Records).
- `API_DESIGN.md` "HR and workplace" (`GET /me/workplace`).
- `SECURITY_AND_PRIVACY.md` (sign-in log, retention).
- `UI_UX_SPECIFICATION.md` S-17.
- Code:
  - `src/server/db/schema.ts` (`signin_logs`, `holidays`);
  - `src/server/auth/session-store.ts`, `login.ts` and `current-user.ts`;
  - `src/modules/holidays/*`;
  - `src/config/navigation.ts`;
  - `src/app/(app)/dashboard/workspace/page.tsx`.

---

## 1. What exists today

| Piece | State |
|---|---|
| Route `/dashboard/workspace` | Placeholder page (`ModulePlaceholder`), no role restriction. In the sidebar under STAFF as "My workplace": "Your leave, company holidays, and CRM sign-in history." |
| `signin_logs` table | `id`, `user_id` (FK users, cascade), `event` (`sign_in` / `sign_out`), `ip`, `user_agent`, `at`. Index `(user_id, at)`. |
| Writes to `signin_logs` | `createSession` writes `sign_in` after a successful password login. `revokeSession` writes `sign_out` on an explicit sign-out (logout action and `POST /api/v1/auth/logout`). |
| What is **not** logged | Failed sign-in attempts (the rate limit is kept in memory only). Sessions that end by idle expiry (12 h) or absolute expiry (7 days). Sessions revoked by `revokeAllSessions`. |
| IP source | `requestMeta()`: first value of `X-Forwarded-For`, then `X-Real-IP`, otherwise null. Without a trusted proxy in front, the client can set this header, so the value is "IP as recorded", not a verified address. |
| Dev data (counted 30 Oct) | 110 rows (67 sign-ins, 43 sign-outs) for 11 users. IP is present on every row, but all are loopback addresses because this is local development. User agent is present on every row. |
| Readers of `signin_logs` | Performance only (sign-in / sign-out counts per agent). |
| `holidays` table | Built in the Holidays milestone (`HR_MODULE_PLAN.md` §12). Scope is company or regional, with a free-text region. Currently 0 rows in dev. |
| Holidays services | `listHolidays` requires `canViewHolidays` (super admin, admin, HR, manager). There is no read for agents or accountants yet. |
| Leave | Nothing exists: no table, service or API. |

Conclusion: **no new tables and no migration are needed.** Both buildable sections read existing tables.

---

## 2. Reference UI (read-only SaleStorm capture, `HR_MODULE_PLAN.md` §1.1)

- **Header:** "Your leave, company holidays, and CRM sign-in history (web sessions)."
- **Tiles:**
  - UPCOMING HOLIDAYS — "Next on the calendar".
  - LEAVE · 2026 — "Requests this year".
  - SIGN-INS LOGGED — "Recent CRM sessions".
- **Upcoming holidays** — "Company-wide and your organization's dates from HR."
- **My leave** — "Requests you submitted (status and dates)", with a year selector.
- **CRM sign-in log** — "Recorded when you sign in or out of this CRM (password sessions)". Each row reads like "Signed in · date time · IP".

The reference was captured as an agent, so the page is open to every role.

---

## 3. Dependency assessment

| Section | Depends on | Blocked? |
|---|---|---|
| **Upcoming holidays** | The `holidays` table and service (done). The permission row "Holidays: see dates (via Leave / My Workplace)" is ✓ for all six roles (`HR_MODULE_PLAN.md` §5). | **No.** One limitation, see 3.1. |
| **Sign-in history** | `signin_logs` (exists, written by current auth), plus the signed-in actor. FR-002 says the entry "appears in My Workplace → sign-in log". | **No.** Read-only; auth is not changed. |
| **My leaves** | Leave requests table, statuses and balances. These need **Q3, Q3b, Q5, Q6** (blocking) and the Q4 / Q8 / Q14 / Q15 defaults (`HR_MODULE_PLAN.md` §9). Q1 is answered in practice by Employee Records (profiles hang off CRM users), but the client has not confirmed it. | **Yes.** Keep pending. |

### 3.1 Open points that do not block, but need a choice

| # | Point | Proposed handling |
|---|---|---|
| W1 | "Your organization's dates" implies regional holidays filtered to the user's region. Employees have no region yet; that is **Q9**. | Until Q9 is answered, show company-wide **and** regional holidays, each regional one labelled with its region. Nothing is filtered by guessing a region. Alternative: company-wide only. |
| W2 | "SIGN-INS LOGGED · Recent CRM sessions" doesn't say over what period. | Count the user's own sign-in events in the **last 30 days** and label the tile with that period. Alternative: all rows kept. |
| W3 | How far ahead "upcoming" reaches. | The next 10 holidays from today (Asia/Karachi), with no end date. The tile shows the next one and "in N days". |
| W4 | How to show the browser. | A short label built from the stored user agent (for example "Chrome · Windows"), falling back to "Unknown browser". The full user agent is shown on hover. |
| W5 | IP trust. | Show "IP" exactly as stored. In development every value is loopback. Production must sit behind a proxy that overwrites `X-Forwarded-For`; this is a deployment note, not a code change. |
| W6 | Retention. | `SECURITY_AND_PRIVACY.md` proposes 12 months (still to confirm). Nothing is pruned today, and My Workplace adds no pruning. The list shows whatever is stored. |

### 3.2 What will not be shown (nothing invented)

- No attendance, hours worked, "present / absent" days or session durations. Pairing sign-ins with sign-outs would be guesswork, because expired sessions log no sign-out; attendance is Q-H2.
- No location, city or ISP lookup from the IP.
- No failed sign-in attempts (they are not stored).
- No "current session" badge: `sessions` and `signin_logs` rows are not linked.
- No leave numbers. The LEAVE tile and My leave panel show a clear "waiting on HR decisions" state.

---

## 4. Permissions (server-enforced)

| Action | Super admin | Admin | Manager | Agent | HR | Accountant |
|---|---|---|---|---|---|---|
| Open My Workplace | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Upcoming holidays (read-only) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Own sign-in history | ✓ own | ✓ own | ✓ own | ✓ own | ✓ own | ✓ own |
| Anyone else's sign-in history here | — | — | — | — | — | — |
| "Open holiday calendar" link | ✓ | ✓ | ✓ | — | ✓ | — |

- The sign-in query always uses the signed-in actor's id. The page and API take **no user id parameter**, so another person's history cannot be requested.
- The existing HR Holidays page keeps its current rule (agents and accountants get Access denied). My Workplace gets a separate read-only function that returns only upcoming holidays: date, name, scope and region. It never returns who created or edited them.
- Inactive users cannot sign in, so they never reach the page (unchanged).

---

## 5. Design

### 5.1 Server

| Piece | Detail |
|---|---|
| `src/modules/holidays/service.ts` | Add `upcomingHolidays(db, actor, { limit })`: any authenticated actor; date ≥ `businessToday()`; ordered by date, then scope (company first), then name. Returns `{ today, rows, next }`. Reuses the `holidays` table. |
| `src/modules/workplace/service.ts` | `listMySignins(db, actor, input)`: filters on `user_id = actor.id`; optional `event` filter; 25 per page, newest first; returns rows (`event`, `at`, `ip`, `userAgent`) and the 30-day sign-in count. `getMyWorkplace(db, actor)` combines both for the page. |
| `src/modules/workplace/validation.ts` | Query schema: `event` (`sign_in` / `sign_out`, otherwise ignored) and `page` (lenient, as in the other list queries). |
| `src/modules/workplace/user-agent.ts` | A small, conservative browser / OS label with an "Unknown browser" fallback. |
| API | `GET /api/v1/me/workplace` (as named in `API_DESIGN.md`): `{ holidays, signins, leave: { status: "pending_client_decision" } }`. Rejects a `userId` / `user` parameter with 400 rather than ignoring it. |
| Auth | **Unchanged.** No edits to `login.ts`, `session-store.ts`, `current-user.ts` or the logout routes. |

### 5.2 UI (`/dashboard/workspace`)

- `PageHeader` with the nav item's title and description.
- Three `MiniStat` tiles:
  - **Upcoming holidays**: the next holiday's name and "in N days", or "None scheduled".
  - **Leave · 2026**: "—", "Waiting on HR decisions".
  - **Sign-ins logged**: N, "Last 30 days".
- **Upcoming holidays** `PanelCard`: date, weekday, name, and a "Company-wide" or region tag. Empty state: "No upcoming holidays on the calendar." Managers, HR and admins also get an "Open holiday calendar" link.
- **My leave** `PanelCard`: an explanation that leave requests start once the leave rules are confirmed. No form and no fake rows.
- **CRM sign-in log** `PanelCard`:
  - "Recorded when you sign in or out of this CRM (password sessions)."
  - Rows show "Signed in" or "Signed out", the date and time (Asia/Karachi, the existing `formatDateTime`), the IP and the browser label.
  - An event filter (All / Sign-ins / Sign-outs) and `Pagination`.
  - Footnote: "Sessions that expire on their own are not recorded as sign-outs."
- `loading.tsx` with the existing skeleton.
- Layout: tiles in 1 / 3 columns; the panels stack on mobile and sit in two columns at `xl`. The sign-in log becomes a list on narrow screens and a table from `md` up.

### 5.3 Navigation

The existing "My workplace" item stays as it is, visible to every role. No change.

---

## 6. Tests

**Unit**
- The user-agent label: Chrome, Edge, Firefox, Safari; Windows, macOS, Android, iOS; empty or unknown values.
- Lenient query parsing.

**Integration (PostgreSQL)**
- Sign-ins:
  - each of the six roles sees only their own rows, and another user's rows never appear;
  - newest first, with pagination and the event filter;
  - the 30-day count excludes older rows and sign-outs;
  - a real `createSession` / `revokeSession` round trip appears in the list;
  - a `userId` parameter is rejected.
- Holidays:
  - an agent and an accountant can read upcoming holidays;
  - today is included and yesterday excluded (Asia/Karachi);
  - the order is date, then company before regional;
  - the limit is applied;
  - no editor fields are returned;
  - the HR Holidays page rule is unchanged (an agent still gets FORBIDDEN from `listHolidays`).
- Auth regression: the existing auth and session tests pass unchanged.

**Full regression:** vitest (all suites), typecheck, lint, production build, and the drizzle drift check (expecting no changes).

**Browser** (real `/login`, verify.* accounts):
- All six roles open My Workplace and see only their own sign-in rows. A fresh sign-in appears at the top.
- Holidays: add a test holiday as admin, confirm agent and accountant see it, then delete it.
- The calendar link appears only for manager, HR and admins.
- Layout at 375 / 768 / 1440 with no page overflow.
- Console and server log checked.

---

## 7. Sequence

| Step | Work | Needs |
|---|---|---|
| 0 | Confirm W1–W4 (or accept the proposed handling) | — |
| 1 | `upcomingHolidays` + tests | — |
| 2 | Workplace service, user-agent label, API + tests | — |
| 3 | Page, loading state, panels | 1, 2 |
| 4 | Full regression and drift check; browser checks for all roles and widths; clean up test data | 3 |
| 5 | Update this plan with an implementation log | 4 |
| Later | **My leaves**: leave tile, year selector, own requests list | Leave milestone (Q3, Q3b, Q5, Q6) |
| Later | Region-filtered holidays | Q9 |
| Later | Attendance (separate from sign-ins) | Q-H2 |

---

## 8. Implementation log — Upcoming holidays and Sign-in history (30 Oct 2026)

### Decisions applied (approved)
- **W1:** company-wide and regional holidays are both shown; regional ones are tagged "Regional · <region>". No employee region is assumed.
- **W2:** the "Sign-ins logged" tile counts the user's own `sign_in` events in the last 30 days, using the database clock.
- **W3:** the next 10 holidays from today in Asia/Karachi (`businessToday()`), today included.
- **W4:** a short browser label ("Chrome · Windows"); the full stored user agent is the hover title on desktop.

### Database
- **No migration and no new table.** Reads `holidays` and `signin_logs` only. `drizzle-kit check` reports no issues and `schema.ts` is unchanged.

### Server
| File | Change |
|---|---|
| `src/modules/holidays/service.ts` | Added `upcomingHolidays(db, { limit, today })` and `daysBetween`. Returns id, date, name, scope, region, days away; never editor fields. Ordered date, then company before regional, then name. `listHolidays` and its role check are unchanged. |
| `src/modules/workplace/service.ts` | `listMySignins` (always `user_id = actor.id`, event filter, 25 per page, newest first, 30-day count) and `getMyWorkplace` (holidays + sign-ins + `leave: { status: "pending_client_decision" }`). Any `userId`, `user_id`, `user`, `employeeId` or `agentId` parameter is rejected with 400 VALIDATION_FAILED. |
| `src/modules/workplace/validation.ts` | Lenient `event` / `page` query, page size 25, 30-day window, event labels. |
| `src/modules/workplace/user-agent.ts` | `browserLabel`: Edge, Opera, Samsung Internet, Firefox, Chrome, Safari; iOS, Android, Windows, ChromeOS, macOS, Linux; otherwise "Unknown browser". |
| `src/app/api/v1/me/workplace/route.ts` | `GET ?event&page` for any signed-in role (401 when signed out). |
| Auth | **Not modified.** `login.ts`, `session-store.ts`, `current-user.ts` and the logout routes are untouched. |

### UI (`/dashboard/workspace`, replaces the placeholder)
- Header "My workplace" with the reference description.
- Tiles: **Upcoming holidays** (next name, date, "In N days" / "Today" / "Tomorrow", or "None scheduled"); **Leave · 2026** ("—", "Waiting on HR decisions"); **Sign-ins logged** (count, "Last 30 days").
- **Upcoming holidays** panel: date, weekday, name, scope tag, days away; empty state "No upcoming holidays on the calendar."; "Open holiday calendar" link only for super admin, admin, manager and HR.
- **My leave** panel: explains that leave requests start once the leave rules are confirmed. No form, no numbers.
- **CRM sign-in log** panel: All / Sign-ins / Sign-outs filter, a table from 768 px up (Event, Date & time, **IP (as recorded)**, Browser) and a stacked list below it, pagination, and the footnote "IP addresses are shown as recorded by the CRM and are not verified. Sessions that expire on their own are not recorded as sign-outs, and failed sign-in attempts are not listed."
- `loading.tsx` with the shared skeleton.
- Nothing about attendance, hours, session durations or locations is shown or computed.

### Tests
- `tests/unit/workplace-rules.test.ts` (4): browser labels for 9 real user agents and the fallbacks; lenient query; calendar day distance across month, year and leap-day boundaries.
- `tests/integration/workplace.test.ts` (9):
  - each of the six roles sees exactly their own rows; a user with none sees an empty log;
  - every foreign-user parameter is rejected, for agent and super admin alike;
  - newest-first order, pagination (25 + 6), page clamping, event filter, stored null IP / user agent shown as "—" / "Unknown browser", and rows carry only stored fields;
  - the 30-day count excludes older rows, sign-outs and other users;
  - a real `createSession` / `revokeSession` round trip appears;
  - holidays: today included, yesterday excluded, company before regional on the same day, limit 10, calendar fields only;
  - Pakistan time: 19:30 UTC on 30 Oct is already 31 Oct;
  - all six roles get holidays through My Workplace while `listHolidays` still refuses agent and accountant;
  - empty holiday list.
- **Full regression:** 26 files, **255 / 255 tests pass** (242 before + 13 new). Typecheck, lint and production build are clean (`/dashboard/workspace` and `/api/v1/me/workplace` built). Drift check clean.

### Browser verification (real `/login` form, verify.* accounts, dev server on 3100)
| Role | My Workplace API | Foreign-user param | HR Holidays API | Calendar link | Page |
|---|---|---|---|---|---|
| Super admin | 200 | 400 (`user_id`) | 200 | Shown | Renders; regional tag, "IP (as recorded)", leave pending |
| Admin | 200 | 400 (`userId`) | 200 | Shown | Same |
| Manager | 200 | 400 (`user`) | 200 | Shown | Same |
| Agent | 200 | 400 (`userId`) | 403 | Hidden | Same, no Access denied |
| HR | 200 | 400 (`employeeId`) | 200 | Shown | Same |
| Accountant | 200 | 400 (`agentId`) | 403 | Hidden | Same, no Access denied |
| Signed out | 401 | — | — | — | Redirects to `/login` |

- **Own rows only:** each role's API total matched that account's `signin_logs` count in the database at the time of the check (the five roles that signed out afterwards are exactly one `sign_out` row higher now).
- **Holidays:** admin added a company-wide and a Lahore regional test holiday 3 days ahead; all six roles saw both, labelled, "In 3 days". Both were then deleted (200) and the empty state "No upcoming holidays on the calendar." / "None scheduled" was confirmed.
- **Filters and paging:** Sign-outs filter returned only sign-outs (6 for super admin) with the filter shown as selected; `page=2` beyond the end clamps to page 1.
- **Hover:** all 17 desktop rows carry the full user agent as the title.
- **Layouts:** 1440, 768 and 375 px checked by screenshot; no horizontal page overflow at any width. At 375 the sign-in log switches to the stacked list.
- **Logs:** no server errors after a dev-server restart (see below). Console errors were only the hot-reload socket during the restart and the deliberate 400 / 403 responses.

### Issues found and fixed during verification
- The first page load after adding `upcomingHolidays` failed in the dev server with "upcomingHolidays is not a function" while the API route worked. It was a stale dev module cache (the production build ran alongside the dev server); restarting the dev server fixed it with no code change.

### Remaining issues
- **IP values:** every stored IP in development is loopback (`::1`). Production must run behind a proxy that overwrites `X-Forwarded-For`; otherwise the stored value can be set by the client. This is a deployment note; auth was not changed.
- **Hover on touch screens:** the full user agent is a hover title, so phones show only the short label.
- **Test data:** no holidays remain. New `signin_logs` rows (sign-ins and sign-outs from the role checks) and two holiday create / delete audit pairs were added; no other records changed.
- **Retention:** sign-in logs are still never pruned (12 months proposed in `SECURITY_AND_PRIVACY.md`, unconfirmed).

### Still pending
- **My leaves** — needs Q3, Q3b, Q5, Q6 (and the Q4 / Q8 / Q14 / Q15 defaults).
- Region-filtered holidays — Q9.
- Attendance — Q-H2 (sign-ins are never attendance).

### Update 30 Oct 2026 (`PRODUCTION_READINESS_PLAN.md`)
- The panel is now **"CRM Sign-in History"** with the subtitle **"Authentication activity"**; the tile caption says "not attendance".
- The footnote says the history is not an attendance record, that IPs come only from the trusted proxy, and states the retention policy.
- IPs are now recorded only behind a configured trusted proxy (`DEPLOYMENT_PROXY.md`); in production without it the IP column shows "—".
