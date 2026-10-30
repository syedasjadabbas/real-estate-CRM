# Teams & Targets Module (FR-110, FR-111, FR-120–122) — Plan and Implementation Record

Status: **implemented and verified 29 Oct 2026** (§6–§10).
- **Tests:** 192 / 192 pass; typecheck, lint and build are clean.
- **Browser:** checked for all six roles, at 375, 768 and 1440.
- **Open:** client questions TQ1–TQ8 (§1.4). Nothing is committed.

## Sources

**Documents:**
- `REQUIREMENTS.md`: FR-110, FR-111, FR-120, FR-121, FR-122, FR-029.
- `MODULES_AND_FEATURES.md` §9 (Targets) and §10 (Teams).
- `USER_FLOWS.md` §8 and §9.
- `USER_ROLES_AND_PERMISSIONS.md`:
  - Targets: set F/F/T/—/—/—;
  - Targets: view F/F/T/O/—/—;
  - Teams / daily report / roster F/F/T/R (own roster)/R/—.
- `DATA_MODEL.md` §2 (teams, team_members), §6 (targets), §7 (daily_reports, daily_report_lines, roster_entries).
- `API_DESIGN.md` (Targets; Teams, daily reports, roster).
- `ASSUMPTIONS_AND_OPEN_QUESTIONS.md`: Q-R2, Q-L2, Q-H3, Q-H4, A-12.
- `ADMIN_WALKTHROUGH_CHECKLIST.md` §5 defaults: Q-H3 "Manual", Q-H4 "Booking confirmation".
- `UI_UX_SPECIFICATION.md`: S-15, S-16.
- `IMPLEMENTATION_ROADMAP.md` (P5).
- The Meetings, Tasks and Bookings plans.

**Reference:** viewed **read-only** on 29 Oct 2026 as a Sales Agent. I only switched view filters (period, tab); nothing was created, edited or saved. A live "Assigned to you" popup was left alone.

**Existing code:**
- `teams` (name unique, manager_id, is_active) and `team_members` (team_id, user_id) already exist.
- They are used by lead rotation, which only rotates among active agents in **active** teams.
- They also drive every manager "team" scope: `managedTeamIds` comes from `teams.manager_id` for role `manager`, and `teamMemberIds()` from `team_members`.
- Development data: "Demo Sales Team" (manager@mz.local; 3 members) and "Verification Team (test)" (verify.manager; 2 members).
- Teams and Targets are currently placeholder pages, already in navigation under MANAGEMENT.

---

## 1. Evidence

### 1.1 Verified reference behaviour (29 Oct 2026)

| Area | Observed |
|---|---|
| Targets header | "Targets" / "Goals set for your user for the selected period (daily / weekly / monthly)." |
| Targets filters | PERIOD segmented Daily / Weekly / Monthly (default **Monthly**); ANCHOR DATE (date input); "PERIOD START (UTC) 2026-10-01"; "Clear filters" |
| Period start | Monthly → 1st of the month; **Weekly → Monday** (anchor 1 Oct → 28 Sep); Daily → the anchor date |
| Targets table | Card "Agent targets", sub-title "MONTHLY · 2026-10-01 (UTC start)", pill "1 AGENT", **"Export CSV"** button; columns **Agent, Calls (qualified), Meetings, Sold sqft, Actions** |
| Achievement | Each cell shows **achieved / target** and a **%** (e.g. "429 / 1,300 · 33%", "5 / 20 · 25%", "0 / 350 · 0%"). With no target for the period the row shows plain "0". Actions shows "—" for an agent. |
| Teams header | "Sales Teams" / "Manage sales teams, members, performance, and manager daily reports." |
| Teams tiles | TEAMS "In directory", ACTIVE "Assignable", INACTIVE "Hidden from assignment", MEMBERS "Across all teams" |
| Teams tabs | Teams · Daily Report · Duty Roster. The Teams tab is **Access denied** for an agent (list "Select a team to manage members." / "No teams found." and a Members panel). |
| Daily Report | "Managers enter Leads, Calls, Meetings, Tokens, Bookings, and Remarks for each agent. Admins can review submissions date-wise below."; TEAM select, REPORT DATE; "Agent entries" / "Select a team to enter today's report."; "Date-wise submissions" / "Admins see all teams; managers see their own. Click a row to open that day."; Filters; "Showing 2026-10-15 → 2026-10-29" (**last 15 days by default**) |
| Duty Roster | "DUTY CALENDAR" / "Who is on, who is off" / "Mark duty for the team. Leads off days are excluded from Avg M / Avg QC."; **Save roster**; TEAM, VIEW Day / Month, DATE; **"Locked after 11:00 — view only"**; counters In office / On site / On leave / Leads off; "Select a team to edit the roster." |

### 1.2 Documented requirements

| ID | Requirement |
|---|---|
| FR-110 | Managers set per-agent targets for calls, meetings and sold sq ft for daily / weekly / monthly periods. The agent sees their own; the manager sees the team. |
| FR-111 | Show achievement vs target (% progress), computed from logged calls, meetings and bookings. |
| FR-120 | Teams: name, manager, members, active / inactive (inactive = excluded from rotation). |
| FR-121 | Manager daily report per agent: leads, calls, meetings, tokens, bookings, remarks; admin date-wise review. **One report per team per date; editable on the same day.** |
| FR-122 | Duty roster: per member per day In office / On site / On leave / Leads off; Day and Month view. |
| Q-H3 (default) | Daily report entry is **manual** |
| Q-H4 (default) | "Sold sq ft" achievement is counted at **booking confirmation** |
| DATA_MODEL | targets unique (user, period, period_start); daily_reports unique (team, date); roster_entries unique (user, date) |

### 1.3 Proposed assumptions (safe; can change without data migration)

| # | Assumption | Why it is safe |
|---|---|---|
| T-A1 | **Teams create / edit / activate / membership: admins only** (super admin, admin). Managers **view** their own teams; HR views all (read-only). Agents have no Teams tab. | The matrix gives managers "T", but letting a manager add members would widen their lead scope to that member's leads. Restricting it avoids that data exposure. |
| T-A2 | A team manager must be an active user with role **manager**. Members must be active **agents or managers**. A user may belong to several teams (the current schema allows it; Q-R2 open). | Matches how scopes are computed today |
| T-A3 | Teams are **deactivated, never deleted** | Leads, rotation and history reference them |
| T-A4 | Daily report: the team's manager, admins and super admins can enter or edit it, **on the report date only** (Pakistan time). Earlier dates are read-only for everyone. HR reads all; agents have no access. | FR-121 "editable on the same day" |
| T-A5 | Daily report lines cover the team's current **agent** members. Counts are whole numbers ≥ 0; remarks are optional. | Manual entry (Q-H3) |
| T-A6 | Roster: manager, admin and super admin can edit a team member's status for a date **until 11:00 Pakistan time that day**. Future dates are editable; past dates and today after 11:00 are view-only. The lock applies to every role. Agents see only their own roster; HR reads all. | Observed lock; documented read rights |
| T-A7 | Roster statuses are **recorded only**. They do **not** change lead rotation yet: "leads off / on leave → skip in rotation" is INFERRED (A-12, Q-L2) and needs confirmation. | Avoids changing live lead assignment on an unconfirmed rule |
| T-A8 | Targets are set by admins (any agent) and managers (agents in their teams), for **agents** only. Values are calls and meetings (whole ≥ 0) and sold sq ft (≥ 0, 2 decimals). Saving all three as 0 or blank clears the target. | Matrix + FR-110 |
| T-A9 | **Achievement windows** use the period start and the next period start in **Pakistan time** (the reference labels its start as UTC; the rest of this app uses Pakistan time). The period start is normalised: daily = the date, weekly = Monday, monthly = the 1st. | Consistent with the rest of the app |
| T-A10 | **Meetings achieved** = **completed** meetings where the agent is the organizer and the start falls in the window | Meetings module data |
| T-A11 | **Sold sq ft achieved** = area of the agent's bookings **confirmed** in the window (Q-H4 default) | Bookings data |
| T-A12 | **Calls (qualified) achieved: not available.** There is no call-recording or call-log data in the system yet, so the target is shown with "— (no call data yet)" and no %. | Nothing invented |
| T-A13 | Export CSV contains the visible grid: agent, the three targets and the available achievements, for the selected period | Observed button |

### 1.4 Questions for the client (none blocks this implementation)

| # | Question |
|---|---|
| TQ1 (Q-R2) | Can a user be in several teams? Can a manager manage several teams? |
| TQ2 | May managers add or remove members of their own team (T-A1)? |
| TQ3 (A-12 / Q-L2) | Should "Leads off" and "On leave" exclude an agent from rotation that day? |
| TQ4 | Does the 11:00 roster lock also apply to admins? Can past days ever be corrected? |
| TQ5 | Can a daily report be corrected after its date, and by whom? |
| TQ6 | Which calls count as "qualified" (the reference Performance page mentions ≥ 60 s), and where will call data come from? |
| TQ7 | Should achievement periods use UTC (as the reference label says) or Pakistan time? |
| TQ8 | Should managers' own targets be supported (the reference grid says "Agent")? |

## 2. Scope

**In scope:**
- **Teams:** the tab with tiles, team list, members panel, and admin create / edit / activate / deactivate and membership.
- **Daily Report:** team + date entry grid; save; date-wise submissions with a date-range filter (default last 15 days); open a day.
- **Duty Roster:** team, Day and Month views, date, status per member, counters, the 11:00 lock, Save roster.
- **Targets:** period, anchor date, period start, Clear filters; "Agent targets" grid with achievement and %; set or edit per agent; Export CSV.
- Audit and history for every write; server-side permissions; responsive UI.

**Out of scope:**
- Rotation changes from the roster (T-A7).
- Call logs and qualified calls (T-A12).
- Performance analytics: Avg M, Avg QC, Critical.
- The "team performance" panel.
- External integrations.

## 3. Database (additive migration `0008_teams_targets`)

- **No change to `teams` or `team_members`.**
- **New enums:** `target_period` (daily, weekly, monthly) and `roster_status` (in_office, on_site, on_leave, leads_off).
- **`targets`:**
  - columns: user_id, period, period_start, calls, meetings, sold_sqft, set_by_id, timestamps;
  - unique (user_id, period, period_start);
  - checks: values ≥ 0; a weekly start is a Monday; a monthly start is the 1st.
- **`daily_reports`:** team_id, report_date, submitted_by_id, timestamps; unique (team_id, report_date).
- **`daily_report_lines`:** daily_report_id (cascade), agent_id, leads, calls, meetings, tokens, bookings (≥ 0), remarks; unique (report, agent).
- **`roster_entries`:** team_id, user_id, date, status, set_by_id, updated_at; unique (user_id, date).
- **Audit:** `audit_logs` entries `team.*`, `target.*`, `daily_report.*`, `roster.*`.
- **Data safety:** drift check before and after; row counts compared before and after.

## 4. Permissions (server-enforced)

| Action | Super admin | Admin | Manager | Agent | HR | Accountant |
|---|---|---|---|---|---|---|
| View teams | All | All | Own teams | — | All (read) | — |
| Create / edit team, membership | ✓ | ✓ | — (T-A1) | — | — | — |
| Daily report view | All | All | Own teams | — | All (read) | — |
| Daily report enter / edit (same day) | ✓ | ✓ | Own teams | — | — | — |
| Roster view | All | All | Own teams | Own entries | All (read) | — |
| Roster edit (before 11:00 / future) | ✓ | ✓ | Own teams | — | — | — |
| Targets view | All agents | All agents | Team agents | Own | — | — |
| Targets set | Any agent | Any agent | Team agents | — | — | — |

## 5. Tests and verification

- **Unit:** period normalisation, the permission matrix, locks, validation.
- **PostgreSQL:**
  - teams CRUD and membership rules (role checks, uniqueness, deactivation, rotation unaffected beyond the existing active flag);
  - daily report upsert, same-day lock and scopes;
  - roster upsert, 11:00 lock and agent own-only view;
  - targets upsert, clear, scopes and achievement from real meetings and bookings;
  - CSV export;
  - audit;
  - HR and accountant access.
- **Browser:** the real /login form for every role; 375 / 768 / 1440; console and server log; full regression; typecheck, lint, build.

---

## 6. What was built

| Area | Files |
|---|---|
| Schema | `src/server/db/schema.ts`: `targetPeriod`, `rosterStatus`, `targets`, `dailyReports`, `dailyReportLines`, `rosterEntries` (no change to `teams` / `team_members`) |
| Migration | `drizzle/0008_teams_targets.sql` (+ `drizzle/meta/0008_snapshot.json`, `_journal.json`) |
| Teams server | `src/modules/teams/`: `dates.ts` (11:00 roster lock, same-day report lock), `policy.ts`, `validation.ts`, `commands.ts` (create / update team, set members, save daily report, save roster), `queries.ts` (visible teams, tiles, detail + audit trail, form options, daily report, date-wise list, roster day / month, my roster) |
| Targets server | `src/modules/targets/`: `period.ts` (normalisation, Pakistan-time window, %), `policy.ts`, `validation.ts`, `service.ts` (grid with achievement, set / clear, CSV) |
| API | `GET/POST /api/v1/teams`, `GET/PATCH /api/v1/teams/:id`, `PUT /api/v1/teams/:id/members`, `GET/PUT /api/v1/teams/:id/daily-reports/:date`, `GET /api/v1/daily-reports`, `GET/PUT /api/v1/teams/:id/roster?date= / ?month=`, `GET /api/v1/roster/me`, `GET/PUT /api/v1/targets`, `GET /api/v1/targets/export` (CSV) |
| UI | `src/features/teams/` (`actions.ts`, `param-controls`, `teams-panel`, `daily-report-form`, `roster-form`, `roster-views`), `src/features/targets/components/target-edit.tsx` |
| Pages | `src/app/(app)/dashboard/teams/page.tsx` (+ `loading.tsx`): tiles, Teams / Daily Report / Duty Roster tabs. `src/app/(app)/dashboard/targets/page.tsx` (+ `loading.tsx`) |
| Changed | `src/config/navigation.ts`: Targets for super admin / admin / manager / agent; Teams for those plus HR. `tests/support/db.ts`: truncate list |
| Tests | `tests/unit/teams-targets-rules.test.ts` (9), `tests/integration/teams-targets.test.ts` (11) |

## 7. Database and data preservation

- **Drift check before** the change: `check` OK, and `generate` reported "No schema changes".
- **Migration `0008`** is additive only: 2 enums and 4 tables.
- **Drift check after:** `check` OK and `generate` "No schema changes".
- **Row counts:**

| | Leads | Teams | Members | Tasks | Meetings | Bookings | Payments | Users |
|---|---|---|---|---|---|---|---|---|
| Before | 5 | 2 | 5 | 4 | 3 | 3 | 6 | 11 |
| After | 5 | 3 | 6 | 4 | 3 | 3 | 6 | 11 |

  The new team and membership are the test data in §10. No existing row was changed or deleted. Rotation still uses the existing `teams.is_active` rule.

## 8. Tests (all run 29 Oct 2026)

| Suite | Result |
|---|---|
| Unit: period start (monthly 1st, weekly Monday), next period, Pakistan-time window, % flooring, daily-report and roster locks, calendar helpers, both permission matrices, validation | 9 / 9 |
| PostgreSQL integration (see below) | 11 / 11 |
| Full regression (Leads, Clients, Projects, Inventory, Bookings, Finance, Tasks, Meetings, Teams & Targets) | **192 / 192**, 0 failed, 0 skipped (18 files) |
| `npm run typecheck`, `npm run lint`, `next build` | Pass (lint 0 problems; build 76 pages) |

**What the integration tests cover:**
- **Teams:** create and edit, case-insensitive unique names, manager role check, admin-only, audit.
- **Membership:** admin-only, active agents or managers only, added and removed recorded.
- **Visibility:** admin and HR see all; managers their own; agents and accountants none.
- **Daily report:** upsert keeps one report per team per date; totals; same-day lock; team scope; agents-only lines; HR read-only.
- **Roster:**
  - save, clear with null, counters, month grid;
  - agents see only their own entries;
  - the 11:00 lock, past-day lock, members only, operate scope.
- **Targets:** admin and team-manager set; normalisation; no-op when unchanged; zero clears; audit; scope (admin all agents, manager team, agent self); HR and accountant denied.
- **Achievement:** completed meetings only; bookings confirmed in the window; a weekly window; calls unavailable; CSV content.
- **Database constraints:** Monday and 1st checks, non-negative values, uniqueness.

## 9. Browser checks (built-in browser, real /login form for every role)

**Super admin:**
- Teams tiles and tabs render.
- "verification team (TEST)" was refused with "A team with this name already exists".
- Created **VERIFY UI Team**, added Verify Agent ("Members saved (1 added, 0 removed)."), then set it Inactive.
- After a reload: Inactive, 1 member, history (created, members changed, details changed); tiles updated to 3 teams, 1 inactive.

**Manager (`verify.manager`):**
- **Daily Report:** sees only their own team. The default list range is 2026-10-15 → 2026-10-29, as in the reference. Entered today's line for Verify Agent (4 / 23 / 2 / 1 / 0, remarks). "Daily report saved."; the submissions row shows the totals.
- **Earlier dates:** 28 Oct is view-only ("Daily reports can only be entered or changed on the report date.", inputs disabled, no Save).
- **After a reload:** values persisted.
- **Duty Roster, today** (after 11:00): "Locked after 11:00 — view only", no Save.
- **Duty Roster, 30 Oct:** set Verify Agent Leads off and Verify Manager In office. "Roster saved."; counters 1 / 0 / 0 / 1; the Month grid shows OFF / IO on the 30th.
- **Teams tab:** read-only, with no forms. Team `PATCH` and membership `PUT` return **403**.
- **Targets:**
  - Default Monthly / 2026-10-01.
  - **October** shows 674.5 sq ft achieved, from the agent's booking confirmed in October.
  - **November** shows 1 meeting achieved.
  - Saving calls "1.5" was refused ("Calls: use a whole number").
  - Set 100 / 4 / 500, shown as "— / 100 · No call data yet", "1 / 4 · 25%", "0 / 500 · 0%". It persisted after a reload.
  - CSV export: correct content type, filename and rows.
  - Weekly anchor 4 Nov → period start 2 Nov (Monday).

**Agent (`verify.agent`):**
- **Targets:** only their own row, with achievement; Actions "—"; `PUT` returns 403.
- **Teams:** opens on "My duty roster" (30 Oct Leads off). The Teams tab shows **Access denied**, as in the reference. Team, daily-report and team-roster APIs return 403; their own roster returns 200.

**HR (`verify.hr`):**
- Sees all 3 teams.
- The daily report is visible but read-only.
- Daily report save, roster save and team create all return 403. Targets is hidden from the sidebar and its API returns 403.

**Accountant (`verify.accountant`):** Teams and Targets are both hidden from the sidebar and show **Access denied**. Teams, targets, own roster and CSV all return 403.

**Admin (`verify.admin`):** sees all 3 agents in Targets, each with Set. The Teams tab has the New team and Edit team forms and Save members.

**Responsive (375 / 768 / 1440):**
- **Pages:** the Teams tab (team selected), Daily Report (team selected), Roster Day, Roster Month and Targets.
- **Result:** no horizontal page scroll and no clipped visible text at any width. The wide tables (daily report, month grid, targets) scroll inside their own boxes.

**Errors:**
- **Console:** no app errors. The only entries were dev hot-reload drops and the 403s from my deliberate permission probes.
- **Server log:** 0 errors, 0 5xx.

**Not checked:**
- Opening the downloaded CSV in a spreadsheet program; I checked its content by fetching it.
- Editing the roster before 11:00 today in the browser, because the session ran after 11:00. The before-11:00 path is covered by the unit and integration tests with a fixed clock.

## 10. Development test data left

- **Team "VERIFY UI Team"** (`b1a1c8ac-…`): **inactive**, no manager, member Verify Agent. Verify Agent is also in the active Verification Team, so rotation is unaffected.
- **Target:** Verify Agent, monthly 2026-11-01 (calls 100, meetings 4, sold sq ft 500), set by Verify Manager.
- **Daily report:** Verification Team (test), 2026-10-29, one line for Verify Agent.
- **Roster, 2026-10-30:** Verify Agent Leads off, Verify Manager In office.
- **Audit:** matching `audit_logs` entries (`team.*`, `target.create`, `daily_report.create`, `roster.save`).

## 11. Remaining concerns

- **Rotation:** "Leads off" and "On leave" are recorded but do not change rotation (TQ3).
- **Calls:** qualified-calls achievement needs call data (TQ6).
- **Avg M / Avg QC:** the roster text mentions these Performance metrics, which aren't built yet.
- **Team membership:** a user can belong to several teams (TQ1). A manager added as a member of another team would not gain its scope; scope still comes from `manager_id`.
- **Clock-based locks:** both locks (report date and roster 11:00) follow the server's clock in Pakistan time.
