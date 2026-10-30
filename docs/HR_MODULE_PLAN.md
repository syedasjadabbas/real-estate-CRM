# HR Module (FR-140–143) — Implementation Plan

Status (30 Oct 2026):
- **Holidays: implemented and verified** (see §12).
- **Employee records, parts A and B: implemented and verified** (see §14). Adding employees and account changes stay blocked (Q1, Q2, Q16).
- **Leave requests, approvals and balances: not started.** They wait for the blocking questions in §9.

## Sources

**Quotation** (`Zeploy_Tech_Real_Estate_CRM_Quotation_Updated.pdf`, p. 2):
- **HR:** Employee records, Holidays, Leave requests & approvals, Leave balances.
- **My Workplace** is a separate quoted module (My leaves, Upcoming holidays, Sign-in history) that depends on HR data.
- **Payroll is not quoted** (A-09, Q-F6, IMPLEMENTATION_ROADMAP "Excluded").

**Documents:**
- `REQUIREMENTS.md`: FR-140, FR-141, FR-142, FR-143, FR-130.
- `MODULES_AND_FEATURES.md` §11 and §12.
- `USER_ROLES_AND_PERMISSIONS.md` rows "HR employees / holidays", "Leave: request" and "Leave: approve", plus the role descriptions.
- `DATA_MODEL.md` §7 (holidays, leave_requests).
- `API_DESIGN.md` "HR and workplace".
- `USER_FLOWS.md` §10 (Leave).
- `ASSUMPTIONS_AND_OPEN_QUESTIONS.md`: B-07, Q-H1, Q-H2, Q-L2, A-09.
- `IMPLEMENTATION_ROADMAP.md`: P5, and the "leave day count" unit test.
- `SECURITY_AND_PRIVACY.md`.

**Reference:** viewed **read-only** on 30 Oct 2026 as a Sales Agent. I only opened and closed a dropdown and the Filters drawer; nothing was submitted. No IP addresses were recorded.

---

## 1. Evidence

### 1.1 Observed in the reference

| Page | Observed |
|---|---|
| `/dashboard/hr` (Overview) | Title **"People & time off"**; "Employee records, holiday calendar, leave requests, and activity. Payroll is managed under Finance."; tabs **Overview / Leave** (agent view); "Modules — Open a section to manage people and time off." Three cards: **DIRECTORY · Employees** ("Roles, departments, contacts, and profiles.") → `/dashboard/hr/employees`; **CALENDAR · Holidays** ("Company-wide and regional holidays.") → `/dashboard/hr/holidays`; **TIME OFF · Leave** ("Requests, approvals, and balances.") → `/dashboard/hr/leave` |
| `/dashboard/hr/leave` | Title **"Leave"** / "Requests, approvals, and annual leave balance (30 days / year)."; **Filters** and **Request leave** buttons. Tiles **ANNUAL ALLOWED**, **ANNUAL USED**, **REMAINING** (all "0 days" for this agent, despite the "30 days / year" text). **New request**: "Submit annual or CPL leave. Dates are inclusive."; LEAVE TYPE (seen: "Annual leave"), START (date), END (date), REASON ("Optional"), **Submit request**. **Requests**: "All leave requests you can access", sortable **Employee, Type, Dates, Status** and an actions column, "No leave requests match your search or filters.", pagination. **Leave filters** drawer: "Refine requests. Changes apply immediately."; SEARCH, STATUS (All statuses / **Pending / Approved / Rejected / Cancelled**), LEAVE TYPE (All types), Clear all. |
| `/dashboard/hr/employees` | Not visible to an agent (B-07: Access denied; this session never got past "Checking access…") |
| `/dashboard/hr/holidays` | **Access denied** for an agent |
| `/dashboard/workspace` (My Workplace) | "Your leave, company holidays, and CRM sign-in history (web sessions)."; tiles UPCOMING HOLIDAYS ("Next on the calendar"), LEAVE · 2026 ("Requests this year"), SIGN-INS LOGGED ("Recent CRM sessions"); **Upcoming holidays** ("Company-wide and your organization's dates from HR."); **My leave** ("Requests you submitted (status and dates)", year selector); **CRM sign-in log** ("Recorded when you sign in or out of this CRM (password sessions)", e.g. "Signed in · date time · IP") |

### 1.2 Documented requirements

| ID | Requirement | Acceptance |
|---|---|---|
| FR-140 | Employee directory: name, role / designation, department, contact, joining date, status | Admin / HR only |
| FR-141 | Holiday calendar (company-wide and regional) | Holidays appear in My Workplace |
| FR-142 | Leave: types **Annual** and **CPL**; **inclusive** dates; reason; **approval by manager / HR**; annual balance (**30 days default**) | Approved leave reduces the balance; **overlapping requests are rejected** |
| FR-143 | Attendance: sign-in log based (no biometric) | REF-I; clock-in / out to confirm (Q-H2) |
| FR-130 | My Workplace: own leave requests, upcoming holidays, sign-in log | Separate milestone |
| DATA_MODEL | `holidays (date, name, scope company / regional, region)`; `leave_requests (user_id, type annual / cpl, start_date, end_date, days computed, reason, status pending / approved / rejected / cancelled, decided_by, decided_at)`, check end ≥ start | — |
| API_DESIGN | `GET/POST/PATCH /employees` (HR / admin), `GET/POST/DELETE /holidays`, `GET/POST /leave-requests`, `POST /leave-requests/:id/decision`, `GET /me/workplace` | 422 `BUSINESS_RULE` for leave overlap |
| Matrix | **HR employees / holidays F/F/R/—/F/—**; **Leave: request ✓ all six roles**; **Leave: approve F/F/T/—/F/—** | — |
| Security | Every write is audited; scopes are enforced on the server | — |

### 1.3 What exists in the codebase today

| Item | State |
|---|---|
| `users` | id, name, email, password_hash, role, status (active / inactive), timestamps. **No designation, department, phone or joining date.** |
| User management | **None**: there is no screen or API to create or edit users; accounts were seeded |
| `signin_logs` | Written on every login and logout (user, event, IP, user agent, at); already used by Performance |
| `approvals` | Lead-only (`lead_id NOT NULL`, type `lead_lost`), so it is **not reusable** for leave without a schema change |
| `roster_entries` | Has an `on_leave` status set manually by managers (Teams); no link to leave requests |
| `app_settings` | Key / value settings table (FR-009), reusable for an "annual leave days" default |
| Navigation | STAFF group: "My workplace" (`/dashboard/workspace`) and "HR" (`/dashboard/hr`), both placeholder pages with no role restriction |
| Development data | 11 users: super admin 2, admin 1, manager 2, agent 3, HR 2, accountant 1 |

---

## 2. Proposed scope (quotation items only)

| Area | Included | Not included |
|---|---|---|
| Employee records | Directory list, profile view / edit (FR-140 fields), search and filters | Payroll, salary, documents and uploads, CNIC / bank details, organisation chart; **creating CRM login accounts** (pending Q2) |
| Holidays | Calendar list by year, add / edit / delete, company-wide vs regional | Importing public-holiday feeds |
| Leave requests & approvals | Request (any role), cancel, approve / reject with note, filters, sort, pagination, history and audit | Multi-level approval chains (pending Q3), email notifications |
| Leave balances | Annual allowed / used / remaining per user per year | Carry-forward, encashment, accrual (pending Q4) |
| Attendance | — (sign-in counts already appear in Performance; FR-143 waits on Q-H2) | Clock-in / clock-out |
| My Workplace | **Next milestone** (depends on holidays and leave) | — |

---

## 3. UI structure (reusing existing patterns)

| Route | Content | Pattern reused |
|---|---|---|
| `/dashboard/hr` | Header "People & time off" + description; tab bar **Overview · Employees · Holidays · Leave** (tabs shown per role); Overview = the three module cards with "Open →" | Teams tab bar, PageHeader, Card |
| `/dashboard/hr/employees` | Tiles (Employees, Active, Inactive, Departments); toolbar (search name / email / designation; Filters drawer: role, department, status); sortable table (Name, Designation, Department, Role, Contact, Joining date, Status, Actions); pagination | Leads / Tasks toolbar, Filters drawer, sortable table, Pagination |
| `/dashboard/hr/employees/[id]` (+ `/edit`) | Profile facts, edit form (FR-140 fields), change history | Task / Meeting detail and edit pages |
| `/dashboard/hr/holidays` | Year selector; list grouped by month (date, name, scope, region); add / edit form (date, name, scope, region if regional); delete with confirmation | Finance settings panels, Modal |
| `/dashboard/hr/leave` | Header "Leave" + "Requests, approvals, and annual leave balance (N days / year)"; **Request leave** button and **Filters**; tiles **Annual allowed / Annual used / Remaining** (for the viewer); **New request** card (Leave type, Start, End, Reason optional, live day count, Submit request); **Requests** table (Employee, Type, Dates (+ days), Status, Actions: Approve / Reject / Cancel per permission) with the Leave filters drawer (Search, Status, Leave type, Clear all), sorting and pagination | Tasks list + form, Meeting status panel for decisions |

**States for every page:** loading (`loading.tsx` per segment), empty, field validation, success messages, error banners, and Access denied (RestrictedState). Layouts checked at 375, 768 and 1440.

---

## 4. Workflows

**Employees** (HR / admin):
1. Open the directory.
2. Search and filter.
3. Open a profile.
4. Edit designation, department, contact, joining date and annual allowance (if Q4 allows per-employee allowance), plus status (see Q16).

Every change is audited. Managers get a read-only view (matrix "R").

**Holidays** (HR / admin):
1. Choose a year.
2. Add a holiday: date, name, scope (company / regional), region if regional.
3. Edit or delete it.

Everyone else can see the calendar (it drives My Workplace and, if Q5 says so, leave day counts).

**Leave request** (any role, for themselves):
1. Choose the type.
2. Enter start and end (inclusive) and an optional reason.
3. The form shows the day count and the remaining balance.
4. Submit → **Pending**.

The server rejects an overlap with the user's own pending or approved requests (FR-142, 422) and an end date before the start.

**Decision** (manager for their team's members; HR / admin for everyone; never one's own request):
- **Approve** or **Reject**, with an optional note. This sets status, `decided_by` and `decided_at`, and is guarded on the request still being Pending, so two approvers can't both act.
- An approved **Annual** request reduces the balance.

**Cancel:**
- The requester may cancel their own **Pending** request.
- Cancelling an **Approved** request (and restoring the balance) is pending Q8.

**Balance** for year Y = allowance(Y) − approved Annual days in year Y. It is always computed from requests, never stored, as with Finance.

---

## 5. Permissions (server-enforced; from the matrix)

| Action | Super admin | Admin | Manager | Agent | HR | Accountant |
|---|---|---|---|---|---|---|
| HR Overview tab | ✓ | ✓ | ✓ | ✓ (Overview + Leave only, as observed) | ✓ | ✓ (Overview + Leave) |
| Employees: view | All | All | All (R) | — | All | — |
| Employees: edit | ✓ | ✓ | — | — | ✓ | — |
| Holidays: manage | ✓ | ✓ | — (R) | — | ✓ | — |
| Holidays: see dates (via Leave / My Workplace) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Leave: request (own) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Leave: see requests | All | All | Own + team members' | Own | All | Own |
| Leave: approve / reject | All (not own) | All (not own) | Team members' (not own) | — | All (not own) | — |

- **Out-of-scope records** return 404.
- **Self-approval** is blocked. A super admin's own request needs another approver (open question Q3b).
- **Who approves a manager's or HR user's leave** isn't documented (Q3b).

---

## 6. Database (one additive migration, `0009_hr`)

No existing table or column is changed.

| Table | Columns | Constraints |
|---|---|---|
| `employee_profiles` | `user_id` PK → users (cascade), `designation` text, `department` text, `phone` text, `joining_date` date, `region` text (for regional holidays, Q9), `annual_leave_days` integer nullable (per-employee allowance override, only if Q4 allows), `updated_by_id`, timestamps | `annual_leave_days >= 0`; phone format reuses the leads E.164 helper |
| `holidays` | `id`, `date`, `name`, `scope` enum `holiday_scope` (company / regional), `region` text, `created_by_id`, timestamps | `(scope = 'regional') = (region is not null)`; unique (date, scope, lower(coalesce(region, ''))) |
| `leave_requests` | `id`, `user_id` → users (restrict), `type` enum `leave_type` (annual / cpl), `start_date`, `end_date`, `days` integer, `reason`, `status` enum `leave_status` (pending / approved / rejected / cancelled), `decided_by_id`, `decided_at`, `decision_note`, `cancelled_at`, timestamps | `end_date >= start_date`; `days > 0`; `(status in ('approved','rejected')) = (decided_at is not null)`; `(status = 'cancelled') = (cancelled_at is not null)`; index (user_id, start_date), (status, created_at) |
| `app_settings` (existing) | New key `hr.annual_leave_days` = **30** (FR-142 default), seeded `ON CONFLICT DO NOTHING` | — |
| `audit_logs` (existing) | `employee.*`, `holiday.*`, `leave.*` | — |

**Overlap rule.**
- Overlap with the user's own **pending or approved** requests is enforced in the transaction: lock the user's leave rows `FOR UPDATE`, then check.
- A database exclusion constraint would need the `btree_gist` extension, which needs elevated database rights; that is not assumed.

**Leave history.**
- Request, decision and cancellation are already captured by the request row's own fields plus `audit_logs`.
- A separate history table is only needed if multi-step approval is required (Q3).

**Data safety.** Drift is checked before and after; existing row counts are compared before and after; nothing is reset.

**Alternatives depending on Q1:**
- If employees **without CRM logins** must be recorded, `employee_profiles` becomes an `employees` table with its own id and an optional unique `user_id`.
- Leave requests would then reference employees, and HR would file requests for non-users.

---

## 7. Validation rules and edge cases

| Area | Rule / case | Handling |
|---|---|---|
| Employee | Name and email stay owned by the user record | Edited only through user management, if approved (Q2) |
| Employee | Joining date | Valid date; not in the future? (undocumented; allow it and flag) |
| Employee | Contact | Optional; phone validated like leads (country code + number) |
| Holiday | Date + name required; name 2–100 characters | Field errors |
| Holiday | Duplicate date in the same scope / region | Unique index → field error "A holiday already exists on this date" |
| Holiday | Regional without a region, or company with a region | Field error / check constraint |
| Holiday | Deleting a holiday that falls inside an approved leave | Recomputing the balance changes `days` only if Q5 = working days; past requests keep their stored `days` (snapshot) |
| Leave | Type required; start and end required; end ≥ start | Field errors |
| Leave | Day count | Inclusive. **Calendar days vs working days** (weekends / holidays) is **undocumented (Q5)**; the count is stored on the request when submitted |
| Leave | Overlap with own pending / approved | 422 "You already have leave on these dates" |
| Leave | Overlap with rejected / cancelled | Allowed |
| Leave | Annual request beyond the remaining balance | **Undocumented (Q4b)**: block, or allow and show a negative balance |
| Leave | Request spanning two years (e.g. 30 Dec – 2 Jan) | **Undocumented (Q15)**: split the days per year, or count against the start year |
| Leave | Past-dated request | **Undocumented (Q14)**: allowed or blocked |
| Leave | Approve or reject a non-pending request | 422; compare-and-set guard for concurrency |
| Leave | Approve own request | 403 |
| Leave | Manager deciding for someone outside their team | 404 (no existence leak) |
| Leave | User later deactivated | Their requests remain; pending ones stay decidable by HR |
| Leave | CPL and the balance | **Undocumented (Q6)**: CPL is assumed not to reduce the annual balance until confirmed |
| Leave | Half days | Not documented, so not supported |
| Balance | New joiner mid-year | **Undocumented (Q4c)**: full or pro-rated allowance |

---

## 8. Test coverage (planned)

**Unit:**
- Inclusive day count, including single-day, month-end and leap-year cases, and working-day mode if Q5 requires it.
- Overlap detection: touching, contained and partial ranges.
- Balance computation.
- The permission matrix, including self-approval and team scope.
- Validation schemas.

**PostgreSQL integration:**
- Employee profile edit and audit; manager read-only; agent and accountant denied.
- Holidays: create, edit, delete; uniqueness; the regional check.
- Leave:
  - request by each role;
  - overlap rejected (pending / approved) and allowed (rejected / cancelled);
  - approve and reject by manager (team only), HR and admin;
  - self-approval blocked;
  - concurrent decisions (one wins);
  - cancel a pending request;
  - balance after approval;
  - year-boundary behaviour per Q15;
  - list scope and filters, sort, pagination;
  - database constraints.
- **Regression:** the full existing suite (201 tests), plus typecheck, lint and build.

**Browser** (real /login form for each of the six roles):
- employee edit and persistence after reload;
- holiday CRUD;
- leave request → approve and reject → balance tiles update;
- cancel;
- filters;
- Access denied pages and sidebar visibility;
- 375 / 768 / 1440;
- console and server log.

---

## 9. Client decisions needed

**Blocking** (they change the data model or the balance arithmetic):

| # | Question | Why it blocks |
|---|---|---|
| **Q1** | Are employee records the same people as CRM users (one profile per login), or must HR also record staff who have **no CRM login**? | Decides `employee_profiles` vs `employees` and what leave requests point to |
| **Q2** | Who creates and deactivates **CRM user accounts** (login, role, password)? Is that part of HR (FR-140 "status"), or a separate admin "Users" screen (UI spec S-22)? | Account creation is security-sensitive; nothing exists today |
| **Q3** | Leave approval: **one** approval by the team manager **or** HR (matrix reading), or **two steps** (manager, then HR)? (Q-H1) | Changes statuses, history and the UI |
| **Q3b** | Who approves leave for managers, HR staff and admins? | Self-approval must be impossible |
| **Q5** | Day count: **calendar days** inclusive, or **working days** excluding weekends and holidays? Which weekend days? | Determines every balance |
| **Q6** | What is **CPL** (compensatory / casual / paid)? Does it reduce the 30-day annual balance, have its own balance, or neither? | Balance arithmetic |

**Important** (a safe default exists; it would be recorded as an assumption):

| # | Question | Proposed default if unanswered |
|---|---|---|
| Q4 | Is 30 days the same for everyone, or set per employee? (The reference showed 0 days allowed for an agent.) | 30 from settings, with a per-employee override field |
| Q4b | May an Annual request exceed the remaining balance? | Block with a clear message |
| Q4c | Pro-rate the allowance for mid-year joiners? Carry unused days forward? | No pro-rating, no carry-forward |
| Q8 | Can approved leave be cancelled, and by whom? Is the balance restored? | Only HR / admin may cancel approved leave, and the balance is restored |
| Q9 | Which regions exist for regional holidays (offices / cities)? How is an employee's region set? | Free-text region on the holiday and on the employee profile |
| Q12 | Fixed lists for departments and designations, or free text? | Free text, with suggestions from existing values |
| Q14 | Are past-dated (retroactive) leave requests allowed? | Allowed; HR decides |
| Q15 | A request spanning two years counts against which year? | Days split by year |
| Q16 | Does setting an employee "inactive" also block CRM sign-in? | Yes, it reuses `users.status`, but only if Q2 allows HR to change it |
| Q-H2 | Is attendance by sign-ins enough, or is clock-in / out needed? | Sign-ins only (already shown in Performance and My Workplace) |
| Q11 | Should approved leave fill the duty roster ("On leave") or affect lead rotation (Q-L2)? | No automatic link |

---

## 10. Dependencies

| Depends on | For |
|---|---|
| `users` + existing RBAC (`Actor`, `managedTeamIds`, `teamMemberIds`) | Identity, roles, manager team scope for approvals |
| `teams` / `team_members` | "T" scope for manager approval |
| `app_settings` | The default annual allowance (30) |
| `audit_logs`, `signin_logs` | Audit trail; attendance via sign-ins |
| Shared UI (PageHeader, tab bar, toolbar, Filters drawer, Modal, Pagination, PanelCard, Field / Input) | Matching the existing design |
| **Answers to Q1, Q2, Q3, Q3b, Q5, Q6** | Starting the schema and leave logic |
| **Then:** My Workplace (FR-130) | Needs holidays and leave; sign-in log already exists |
| Optional later: unified Approvals inbox | Would list leave, lost and discount approvals together (ASSUMPTIONS "Approvals inbox (unified)") |

---

## 11. Recommended implementation sequence

| Step | Work | Needs |
|---|---|---|
| 0 | Client answers Q1, Q2, Q3, Q3b, Q5, Q6; confirm the defaults for the rest | — |
| 1 | Migration `0009_hr` (tables in §6 and the `hr.annual_leave_days` setting); drift and row-count checks | Q1, Q5 |
| 2 | **Holidays**: service, API, page, tests — **done 30 Oct 2026 (§12)** | Q9 default (free-text region) |
| 3 | **Employee records**: profiles over existing users, directory, edit, audit, tests | Q1, Q2 |
| 4 | **Leave requests**: day count, overlap rule, request and cancel, list and filters, tests | Q5, Q6 |
| 5 | **Approvals**: decide (manager team / HR / admin), self-approval guard, concurrency, tests | Q3, Q3b |
| 6 | **Balances**: tiles, year logic, tests | Q4 defaults, Q15 |
| 7 | HR Overview tab bar, navigation roles, Access denied states | — |
| 8 | Full regression, typecheck, lint, build; browser checks for all roles at 375 / 768 / 1440; update this plan with results | — |
| 9 | Next milestone: **My Workplace** (holidays, own leave, sign-in log) | Steps 2–6 |

---

## 12. Implementation log — Holidays (step 2), 30 Oct 2026

Built only the Holidays section. Employee records, leave requests, approvals and balances were not started, and no leave policy was assumed.

### Database

- Migration `drizzle/0009_holidays.sql` (additive only): enum `holiday_scope` (company, regional) and table `holidays`.
  - Columns: `id`, `date`, `name`, `scope` (default company), `region`, `created_by_id`, `updated_by_id`, `created_at`, `updated_at`.
  - Checks: name not blank; `(scope = 'regional') = (region is present)`.
  - Unique index `holidays_date_scope_region_uq` on `(date, scope, lower(coalesce(region, '')))`: one company-wide holiday per date and one per region per date (case-insensitive).
  - Index on `date`.
- The rest of §6 (`employee_profiles`, `leave_requests`, the allowance setting) is **not** created; it waits for Q1, Q5 and Q6.
- Applied to the development and test databases. Row counts of every existing table were identical before and after the migration (only `holidays = 0` was added). `drizzle-kit check` reports no drift.

### Server

- `src/modules/holidays/policy.ts`: manage = super admin, admin, HR; view = those plus managers. Agents and accountants are denied (matrix F/F/R/—/F/—).
- `src/modules/holidays/validation.ts`:
  - date must be a real calendar date (leap years handled) between 2000 and 2100 (input sanity only);
  - name 2–100 characters, whitespace collapsed;
  - region up to 80 characters, required for regional holidays, not allowed for company-wide ones (Q9 default: free text);
  - list query: year, scope, region, search, sort (date / name), direction; invalid values fall back to defaults.
- `src/modules/holidays/service.ts`:
  - create, update (changed fields only), delete; each writes `audit_logs` (`holiday.create / update / delete`, with before and after);
  - duplicate check with a field error, and the unique index as the final guard against concurrent saves;
  - list for one calendar year (inclusive 1 Jan – 31 Dec), with tiles (total, company-wide, regional, still ahead), the next upcoming holiday and the list of existing regions;
  - dates are stored and compared as `YYYY-MM-DD` strings, so there is no time zone shift; "today" uses the business time zone (Asia/Karachi).
- API: `GET/POST /api/v1/holidays`, `PATCH/DELETE /api/v1/holidays/:id` (API_DESIGN). Delete removes the row; the audit log keeps the snapshot.

### UI

- `/dashboard/hr` now shows the reference overview: "People & time off", tabs (Overview, plus Holidays for roles that can open it) and the three module cards. Employees and Leave cards are marked "Not built yet"; for agents and accountants the Holidays card says it is for HR, admins and managers instead of linking to an Access denied page.
- `/dashboard/hr/holidays`:
  - tiles: Holidays (year), Company-wide, Regional, Next holiday;
  - toolbar: year stepper, List / Calendar switch, search (name or region), Filters drawer (Scope, Region), Clear, count pill, **Add holiday** (HR / admins);
  - List: sortable Date and Holiday columns, Day, Scope, Region, Last updated, and Edit / Delete for HR / admins;
  - Calendar: twelve month grids (weeks start Monday), company-wide days in green, regional-only days in blue, today outlined, and each month's holidays listed under its grid;
  - Add / Edit dialog with field errors; Delete asks for confirmation; a status line confirms each change;
  - managers see the same page read-only; agents and accountants get Access denied.
- `loading.tsx` for both routes. The sidebar entry is unchanged (HR stays visible to every role, as in the reference).

### Tests

- Unit (`tests/unit/holidays-rules.test.ts`, 8 tests): role matrix; date validity (invalid days and months, leap years, year bounds, wrong format); name length; region / scope rules; partial updates; lenient list parsing; weekday names.
- Integration (`tests/integration/holidays.test.ts`, 15 tests, PostgreSQL):
  - permissions for all six roles on create, edit, delete and list;
  - create with audit and exact date storage;
  - invalid input writes nothing;
  - edit audit and scope switching;
  - delete snapshot and 404s;
  - duplicates (company, region case-insensitive, other region and company on the same date allowed, edit collision, concurrent saves);
  - year boundaries, filters, search with `%` / `_`, sorting, default year;
  - database check constraints.
- Regression: **224 / 224** tests pass (201 before + 23 new). Typecheck, lint and production build are clean.

### Browser verification (real `/login` form, local dev server)

- **HR:** empty state; field errors (blank name, regional without region); add a regional test holiday; duplicate blocked for the same region typed in lower case; edit to company-wide persisted after reload; calendar shows the day highlighted with weekdays aligned; scope filter and search work.
- **Admin:** deleted the test holiday through the confirmation dialog. The dev database is back to no holidays; only audit, session and sign-in rows were added.
- **Manager:** page is view-only (no Add / Edit / Delete); `POST /api/v1/holidays` returns 403.
- **Agent and accountant:** Access denied on Holidays, no Holidays tab, API returns 403.
- **Super admin:** covered by the integration tests only, not signed in through the browser.
- **Widths:**
  - 1440 px: checked by screenshot.
  - 375 px: checked by screenshot (list and calendar) and by measurement.
  - 768 px: checked by screenshot (list) and by measurement.
  - No horizontal page overflow at any width; the list table scrolls inside its card, as in Meetings.
- **Console:** only HMR reconnect messages after the dev-server restart and the 403s from the deliberate permission probes.
- **Server log:** one dev-mode "instant UI validation" notice caused by the redirect to `/login` before signing in. It comes from the existing app layout and is not specific to Holidays.

### Remaining dependencies

- Employee records need Q1 and Q2.
- Leave requests, approvals and balances need Q3, Q3b, Q5 and Q6.
- Whether holidays reduce leave day counts is part of Q5. The Holidays page says this is still to be confirmed.
- Regions stay free text until Q9 is answered. No regional holiday data was added.
- My Workplace "Upcoming holidays" can now read from `holidays`, but My Workplace is its own milestone.

---

## 13. Employee Records — dependency assessment (30 Oct 2026, before implementation)

At the time of writing, nothing for Employee Records was implemented (A and B were built afterwards, see §14). This section records what is documented, what is blocked, and what could proceed without client answers.

### 13.1 What exists and what is documented

| Item | Source | State |
|---|---|---|
| FR-140 fields: name, role / designation, department, contact, joining date, status | REQUIREMENTS | Documented; "Admin / HR only" |
| Matrix "HR employees / holidays" F/F/R/—/F/— | USER_ROLES_AND_PERMISSIONS | Super admin, admin and HR full; manager read; agent and accountant none |
| Matrix "Settings, users, roles": super admin F, admin "users only", others — | USER_ROLES_AND_PERMISSIONS | Account management is documented under **Settings → Users (S-22)**, not under HR |
| DATA_MODEL `users`: proposes `phone`, `designation`, `department`, `joined_on`, `annual_leave_quota` as columns on users | DATA_MODEL §2 | A design proposal. The live `users` table has only name, email, role, status |
| Roadmap P2 "users and roles" | IMPLEMENTATION_ROADMAP | Planned, never built: there is no screen or API to create, edit or deactivate accounts |
| Reference Employees page | B-07 | Never seen (Access denied for the agent account), so its fields and actions are unknown |
| Inactive accounts | `src/server/auth/login.ts`, `session-store.ts` | Already enforced: an inactive user cannot sign in and existing sessions stop working |

### 13.2 What each open question blocks

| Decision | Blocks |
|---|---|
| **Q1**: are employees only CRM users, or also staff without a login? | Adding employee records; whether a record must point to a user account; whether leave can be filed for non-users |
| **Q2**: who creates and deactivates CRM accounts, and is that part of HR? | Any create-employee action that also creates a login; changing name, email, role or account status from HR. (The matrix gives users to super admin and admin under Settings; it does not give HR this right.) |
| **Q16**: does "inactive employee" mean the CRM login is disabled? | An employee "status" separate from `users.status` |
| **Q4**: is the annual allowance set per employee? | A leave-allowance field on the profile |
| **Q9**: how is an employee's region set? | A region field on the profile |
| **Q12**: fixed department / designation lists, or free text? | Drop-down lists; only free text avoids inventing values |

### 13.3 What can proceed without Q1 and Q2

**A. Read-only Employees directory of existing CRM accounts.** No migration.
- Shows name, email, role and account status from `users`.
- Search, filters (role, status), sort, pagination.
- Profile page shows the same facts.
- Labelled as CRM accounts. It does not claim to be the full staff register, which depends on Q1.
- Access: super admin, admin and HR; managers read-only; agents and accountants denied (matrix).

**B. HR profile fields for existing CRM accounts.** One additive migration.
- Fields: designation, department, phone, joining date (FR-140).
- Editable by super admin, admin and HR; read-only for managers; every change audited.
- **Storage:** a new table `employee_profiles` with its own `id` and a unique `user_id`.
  - If Q1 = users only, it stays as is.
  - If Q1 = also non-login staff, a later additive change can drop `NOT NULL` on `user_id` and add a name column. Nothing would need to be rebuilt.
  - Nothing is added to `users`, so account data and sign-in stay untouched.
- **Technical choices to confirm** (input format only, not business rules):
  - department and designation as free text (Q12), showing existing values as suggestions;
  - phone validated with the same country-code + number check used for leads;
  - no rule on future joining dates, because none is documented.

**Not built until answered:**
- an "Add employee" action (Q1, Q2);
- editing name, email, role or account status, and activate / deactivate (Q2, Q16);
- leave allowance (Q4) and region (Q9) on the profile;
- documents, CNIC, salary and payroll (outside the quotation).

### 13.4 Proposed UI for A and B (existing patterns)

- **HR tabs:** Overview · Employees · Holidays. The Employees tab shows for super admin, admin, HR and manager. The Employees card on the overview links there for those roles.
- **`/dashboard/hr/employees`:**
  - tiles: Accounts, Active, Inactive, Profiles completed;
  - toolbar: search (name, email, designation), Filters drawer (Role, Status, Department), Clear, count;
  - sortable table: Name, Designation, Department, Role, Phone, Joining date, Status;
  - a "View" link per row.
- **`/dashboard/hr/employees/[id]`:**
  - account facts (read-only, with a note that accounts are managed in Settings, which is pending);
  - HR profile card with Edit for super admin, admin and HR;
  - change history from the audit log.
- **States:** loading, empty, errors, Access denied; checked at 375, 768 and 1440 px.

### 13.5 Tests planned for A and B

- **Unit:** role matrix, profile validation (lengths, phone, date), list query parsing.
- **Integration:**
  - scope per role (manager read-only, agent and accountant 403);
  - profile create-on-first-save and update with audit;
  - users and sign-in untouched;
  - unknown user 404;
  - filters, sort, pagination.
- **Regression:** full suite, typecheck, lint, build.
- **Browser:** all six roles through `/login`, at three widths.

---

## 14. Implementation log — Employee Records A + B, 30 Oct 2026

### Decisions confirmed by the project owner (30 Oct 2026)

- Department and designation are free text, with suggestions from existing entries.
- Phone follows the existing lead phone rules.
- Future joining dates are allowed.
- Account information stays read-only.
- No employee creation, login management, activation / deactivation, salary or CNIC until the client decides.

### Database

- Migration `drizzle/0010_employee_profiles.sql` (additive only) creates the table `employee_profiles`.
  - Columns: `id`, `user_id` (unique, not null, FK users, on delete restrict), `designation`, `department`, `phone_country_code`, `phone_number`, `phone_e164`, `joining_date`, `updated_by_id`, timestamps.
  - Checks: the three phone columns are either all set or all empty; the E.164 format matches leads; designation and department are at most 100 characters.
  - Index on `lower(department)`.
- `users` is not changed.
- Applied to the development and test databases. Row counts of every existing table were unchanged by the migration. `drizzle-kit check` reports no drift.

### Server

- `src/modules/employees/policy.ts`: edit = super admin, admin, HR; view = those plus managers; agents and accountants denied (matrix F/F/R/—/F/—). Nobody can edit their own profile unless their role allows it.
- `src/modules/employees/validation.ts`:
  - free text is trimmed, inner spaces collapsed, blank becomes empty, up to 100 characters;
  - phone uses the lead country-code rule and `normalizePhone`, and a blank number means no phone;
  - joining date must be a real date (years 1900–2100 as input sanity), and future dates are allowed;
  - the object is **strict**, so any other key (name, email, role, status, allowance, region…) fails validation instead of being ignored.
- `src/modules/employees/service.ts`:
  - **directory:** every CRM account joined with its profile; search (name, email, designation, department); filters (role, account status, department in any case); sort (name, designation, department, role, joining date, status; blanks last); pages of 50; tiles (accounts, active, inactive, profiles completed = all four HR fields filled); department and designation suggestions;
  - **profile:** account facts plus the HR profile and up to 50 history entries from `audit_logs`;
  - **save:** created on first save (upsert on `user_id`, so concurrent first saves keep one row); only changed fields are written; `audit_logs` records `employee.profile_create / profile_update` with before and after. `users` is never written.
- **API:** `GET /api/v1/employees`, and `GET` / `PATCH /api/v1/employees/:id` (PATCH accepts profile fields only).

### UI

- **HR tabs:** Overview · Employees · Holidays. The Employees tab shows for super admin, admin, HR and manager. The overview Employees card links there; for agents and accountants it says it is for HR, admins and managers.
- **`/dashboard/hr/employees`:**
  - tiles: Accounts, Active, Inactive, Profiles completed;
  - search, Filters drawer (Role, Account status, Department), Clear, count pill;
  - sortable table: Name + email, Designation, Department, Role, Phone, Joining date, Account, Actions ("Open profile" for editors, "View" for managers);
  - pagination;
  - a note that the list shows CRM accounts only and what is waiting for client decisions.
- **`/dashboard/hr/employees/[id]`:**
  - **CRM account** card, read-only: name, email, role, account status, created, with a note that account management is pending;
  - **HR profile** card: an edit form for editors (designation and department with suggestions, country code + phone, joining date, field errors, a saved message); read-only facts for managers;
  - **Profile history** card.
- `loading.tsx` for both routes; unknown ids show the 404 page.

### Tests

- Unit (`tests/unit/employees-rules.test.ts`, 6 tests): role matrix; free-text normalisation and clearing; lead phone rules (Pakistan and UAE formats, `+92` prefix, blank, too short, bad country code, too long); past, future and invalid joining dates; account fields rejected; lenient list parsing.
- Integration (`tests/integration/employees.test.ts`, 12 tests, PostgreSQL):
  - permissions for all six roles, including an agent editing their own profile;
  - first save with audit and exact storage;
  - changed-fields-only updates and clearing, with history;
  - `users` row byte-for-byte unchanged, and account-field payloads rejected;
  - invalid input writes nothing;
  - inactive account allowed; 404s;
  - concurrent first saves leave one row;
  - directory totals, tiles, suggestions, filters, search with `%`, sorting with blanks last, page clamping;
  - database constraints.
- Regression: **242 / 242** tests pass (224 before + 18 new). Typecheck, lint and production build are clean.

### Browser verification (real `/login` form, local dev server)

- **Admin:**
  - the directory lists all 11 accounts;
  - on the Verify Agent profile, an invalid phone shows "Enter a valid phone number";
  - a valid phone, a future joining date (15 Dec 2027), designation and department saved and persisted after reload;
  - history shows each change; search and the department filter find the account;
  - `PATCH` with `role`, `status` or `name` returns 400.
- **HR:** sees the Employees tab, "Open profile" and the edit form; `PATCH` returns 200.
- **Manager:** page marked "(view only)", "View" links, read-only profile with no form; `PATCH` returns 403.
- **Agent and accountant:** Access denied on the list and on profile pages (including the agent's own), no Employees tab, API returns 403.
- **Super admin:** sees the edit form; cleared the test values through the API (200).
- **Widths:**
  - 1440 px was checked by screenshot.
  - 768 px: the list was checked by screenshot; no page overflow, and the table scrolls inside its card.
  - 375 px: the profile page and form were checked by screenshot; no page overflow.
- **Server log:** no errors.
- **Test data left behind:** one `employee_profiles` row for the Verify Agent test account with all fields empty, plus its audit entries. Nothing else changed, apart from new sign-in and audit rows.

### Still blocked (unchanged from §13.2)

| Feature | Waiting for |
|---|---|
| Add employee, including staff without a CRM login | Q1, Q2 |
| Change name, email or role; activate or deactivate accounts | Q2, Q16 |
| Leave allowance on the profile | Q4 |
| Region on the profile (for regional holidays) | Q9 |
| Fixed department / designation lists | Q12 (free text in use) |
| Salary, CNIC, documents | Outside the quotation |
