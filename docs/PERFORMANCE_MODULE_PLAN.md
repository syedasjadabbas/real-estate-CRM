# Performance Module (FR-150–153, FR-002) — Plan and Implementation Record

Status: **implemented and verified 29 Oct 2026** (§5–§9).
- **Data:** no database migration; every metric is computed from existing tables.
- **Tests:** 201 / 201 pass; typecheck, lint and build are clean.
- **Browser:** checked for all six roles, at 375, 768 and 1440.
- **Not available:** call metrics and the Critical flag, with no data or rule yet (§1.3). Nothing is committed.

## Sources

**Documents:**
- `REQUIREMENTS.md`: FR-150, FR-151, FR-152, FR-153; FR-002 (sign-ins "count in Performance"); FR-026 (follow-up %); FR-143 / Q-H2 (attendance).
- `MODULES_AND_FEATURES.md` §13.
- `USER_ROLES_AND_PERMISSIONS.md` ("Performance F/F/T/O/—/—"; "Performance 'for your scope'").
- `API_DESIGN.md` (`/performance/agents?from&to&teamId&criticalOnly`, `/performance/charts`).
- `ASSUMPTIONS_AND_OPEN_QUESTIONS.md` Q-L8 (Critical rule); `ADMIN_WALKTHROUGH_CHECKLIST.md` §5 (Q-L8 default "Configurable thresholds, set later").
- `UI_UX_SPECIFICATION.md` S-19.
- The completed module plans (Leads, Bookings, Meetings, Teams & Targets).

**Reference:** viewed **read-only** on 29 Oct 2026 as a Sales Agent. I only opened and closed the Filters drawer; nothing was changed. A live "Assigned to you" popup was left alone.

---

## 1. Evidence

### 1.1 Observed reference behaviour

| Area | Observed |
|---|---|
| Header | "Performance" / "Agent KPIs and CRM attendance for your scope (same metrics as team reports)."; "Updated just now · **Refresh**" ("Recompute with the latest data"); **Filters** |
| Filters drawer | "Performance filters" / "Scope, team, and date range. Changes apply immediately."; **CONTEXT** ("Your metrics" for an agent); **FROM / TO** dates; Clear filters, Done. **Default range: the last 30 days** (2026-09-29 → 2026-10-29). |
| Team at a glance | "1 agent in scope"; **WIN RATE** "0 booked of 53 decided leads"; **FOLLOW-UPS DONE** 68% "348 of 513 due in the range"; MEANINGFUL CALLS "0 of 606 recordings scored AI ≥70"; PIPELINE: OPEN LEADS 175 ("175 per agent"), BOOKED 0, LOST 53, with a Booked / Lost split bar; ACTIVITY: CALLS 606 ("606 per agent · 668 min"), MEETINGS 6 ("6 per agent"), CRM SIGN-INS 57 ("57 per agent") |
| Charts | **Outcome mix** ("Open pipeline vs booked vs lost in range", donut total 228 = Open 175 (77%) + Lost 53 (23%); "Win rate on decided leads: 0%."); **Call quality** (Verified ≥30 s, Qualified ≥60 s, Meaningful AI ≥70; "Share of 606 recordings · 668 talk minutes."); **Top closers** ("Bookings closed in selected range"; rank, agent, "Win 0% · 606 calls", count); **Call volume leaders** ("Recordings by agent"); **Calls vs meetings** ("Top agents by combined activity") |
| Table | "Performance & attendance" / "Same KPI columns as team reports: leads, follow-ups, meetings, bookings, calls, and CRM sign-in counts for the date range."; **CRITICAL ONLY** toggle with a count; "1 agent"; **Export CSV**; sortable columns **Agent, Open leads, Booked, Lost, Win %, Calls, Call min, F/U due, F/U done, F/U %, Meetings, CRM sign-ins, CRM sign-outs**; a **CRITICAL** badge on the row; pagination |
| Open leads tooltip | "Assigned leads in the selected date range (all stages). Matches pipeline ALL with the same filters." The numbers shown (Open 175 + Lost 53 = 228 total) suggest "open" excludes lost leads, so the wording and the numbers disagree. |

### 1.2 Documented requirements

| ID | Requirement |
|---|---|
| FR-150 | Agent KPI table: open leads, booked, lost, win %, calls, call minutes, follow-ups due / done / %, meetings, sign-ins / outs. Must match the underlying records for the range. |
| FR-151 | Charts: outcome mix, top closers, call volume, calls vs meetings |
| FR-152 | Call quality buckets (≥30 s verified, ≥60 s qualified) from recording durations; **requires the recording duration to be stored** |
| FR-153 | "Critical" agent flag based on thresholds; "Critical only" filter. **Rule unknown; thresholds configurable** (Q-L8 default: "set later") |
| FR-002 | Every sign-in and sign-out is logged and counts in Performance |
| FR-143 / Q-H2 | ~~Attendance is sign-in-log based~~ — superseded 30 Oct 2026: sign-in counts are authentication activity, not attendance |
| Matrix | Performance F/F/T/O/—/— (admins all, managers team, agents own, HR and accountant none) |

### 1.3 Data available in this system

| Metric | Source | Status |
|---|---|---|
| Leads assigned | `leads` (owner, created_at, stage, stage_changed_at, deleted_at) | ✅ available |
| Booked / Lost | `leads.stage` + `stage_changed_at` | ✅ available |
| Follow-ups due / done | `follow_ups` (assignee, due_at, status) | ✅ available |
| Meetings | `meetings` (organizer, status, starts_at) | ✅ available |
| CRM sign-ins / sign-outs | `signin_logs` (user, event, at), written on every login and logout | ✅ available |
| Calls, call minutes, call quality, meaningful calls, call volume, calls vs meetings | No call-recording or call-log data exists | ❌ **not available** |
| Critical flag | No documented rule or thresholds | ❌ **not available** (Q-L8) |
| Pipeline pressure | Listed in MODULES §13 but not defined anywhere | ❌ **not available** |
| Roster "Avg M / Avg QC" exclusion | Depends on call metrics; undefined | ❌ not available |

### 1.4 Metric definitions (inferred; nothing invented beyond the observed text)

| # | Metric | Definition | Basis |
|---|---|---|---|
| P1 | **Range** | FROM and TO dates inclusive, in Pakistan time (TO runs to the end of the day). Default: the last 30 days, observed. | Observed |
| P2 | **Leads in range** | Leads not deleted, currently owned by the agent, **created** in the range | Tooltip "assigned leads in the selected date range" |
| P3 | **Open leads** | Leads in range (P2) whose current stage is neither Booked nor Lost | Outcome-mix numbers: open + lost = total |
| P4 | **Booked** | Leads in range (P2) now Booked | Same cohort, so open + booked + lost = total, as in the reference donut |
| P5 | **Lost** | Leads in range (P2) now Lost | As P4 |
| P6 | **Win %** | booked ÷ (booked + lost) | Observed: "booked of decided leads" |
| P7 | **F/U due / done / %** | Follow-ups assigned to the agent, **due** in the range, not cancelled; done = those with status done; % = done ÷ due | Observed: "done of due", "due in the range" |
| P8 | **Meetings** | **Completed** meetings the agent organized, starting in the range | The same rule as Targets (T-A10) |
| P9 | **CRM sign-ins / sign-outs** | `signin_logs` events for the agent within the range | FR-002 |
| P10 | **Top closers** | Agents ranked by Booked (P4), then win % | Observed: "Bookings closed in selected range" |
| P11 | **Agents in scope** | Active users with role **agent**: all of them (admins), those in the selected or managed teams (managers), or the agent themselves | Observed: "agent in scope"; matrix |

### 1.5 Questions for the client (none blocks implementation)

| # | Question |
|---|---|
| PQ1 (Q-L8) | What makes an agent "Critical" (which metrics, which thresholds)? |
| PQ2 | "Open leads": all leads assigned in the range (tooltip) or only those still open (numbers)? Implemented as still-open (P3); both are easy to switch. |
| PQ3 | Is a lead's "assignment" its creation date, or the date it was last reassigned to the agent? |
| PQ4 | Do meetings count only when completed, or also when scheduled? |
| PQ5 | Where will call data come from (recordings upload / telephony)? It drives Calls, Call min, Call quality, Meaningful, Call volume and Calls vs meetings. |
| PQ6 | What is "Pipeline pressure"? |
| PQ7 (Q-H2) | Is attendance needed at all? (Sign-in counts are not attendance.) |

## 2. Scope

**In scope:**
- **Page:** `/dashboard/performance` with header, "Updated … · Refresh", and a Filters drawer (Context + From / To + Clear filters + Done).
- **Team at a glance:** win rate, follow-ups done, pipeline (open / booked / lost + split bar), activity (meetings, CRM sign-ins, per-agent averages).
- **Charts:** Outcome mix and Top closers.
- **"Performance & CRM sign-in activity" table** (reference: "Performance & attendance", reworded 30 Oct 2026): sortable, paginated, Export CSV.
- **Clearly marked as unavailable:** Calls, Call min, Meaningful calls, Call quality, Call volume leaders, Calls vs meetings, Critical flag and filter.

**Out of scope:** call data, AI scoring, the Critical rule, Pipeline pressure, the dashboard widgets, changes to rotation or targets.

**Schema:** **no migration needed.** All metrics are computed from existing tables.

## 3. Permissions (server-enforced)

| | Super admin | Admin | Manager | Agent | HR | Accountant |
|---|---|---|---|---|---|---|
| View | All agents; context "All agents" or any team | Same | Agents in teams they manage; context "My teams" or one managed team | Own metrics only ("Your metrics") | — | — |
| Export CSV | ✓ (same scope) | ✓ | ✓ | ✓ (own) | — | — |

A team the actor may not see is rejected with 403. Ranges are validated: dates, from ≤ to, at most 366 days.

## 4. Tests and verification

- **Unit:** range parsing and default, Pakistan-time boundaries, %, win %, scope rules.
- **PostgreSQL:** every metric against seeded records, including boundary cases (just inside and outside the range, deleted leads, cancelled follow-ups, scheduled vs completed meetings, other agents' records); scope per role; team filter; HR and accountant denied; CSV.
- **Browser:** the real /login form for every role; 375 / 768 / 1440; console and server log; full regression; typecheck, lint, build.

---

## 5. What was built

| Area | Files |
|---|---|
| Server | `src/modules/performance/range.ts`: range parsing (default last 30 days, inclusive, Pakistan time, reversed ranges swapped, spans clamped to 366 days), sort keys, page size, `pct`. `src/modules/performance/service.ts`: `canViewPerformance`, `performanceContexts`, agents in scope, per-agent metrics (P2–P9), summary, Outcome mix, Top closers, sorting (missing % last), pagination, `performanceCsv`. |
| API | `GET /api/v1/performance?from&to&team&sort&dir&page`, `GET /api/v1/performance/export` (CSV) |
| UI | `src/features/performance/components/performance-filters.tsx` ("Updated … · Refresh", Filters drawer: Context / From / To / Clear filters / Done); `charts.tsx` (Outcome mix donut, Top closers, and "needs call data" cards for Call quality, Call volume leaders and Calls vs meetings) |
| Page | `src/app/(app)/dashboard/performance/page.tsx` (+ `loading.tsx`): header, **Team at a glance** (win rate, follow-ups done, meaningful calls unavailable, Pipeline open / booked / lost + split bar, Activity calls unavailable / meetings / CRM sign-ins with per-agent averages), charts, **Performance & attendance** table with every observed column (Calls / Call min shown as "—" with a reason), **Critical only** shown disabled with its reason, Export CSV, pagination |
| Changed | `src/config/navigation.ts`: Performance visible to super admin / admin / manager / agent only |
| Tests | `tests/unit/performance-rules.test.ts` (5), `tests/integration/performance.test.ts` (4) |

**Not changed:** lead rotation, target calculations, any schema, the dashboard.

## 6. Data preservation

- **No migration was added:** the latest migration is still `0008_teams_targets`.
- **Drift:** `drizzle-kit check` OK, and `generate` reported "No schema changes".
- **Row counts** are unchanged: leads 5, teams 3, tasks 4, meetings 3, bookings 3, payments 6, targets 1, follow-ups 1.
- **Read-only:** the module only reads data.

## 7. Verified calculations

**PostgreSQL integration test** (range 1–29 Oct = `[2026-09-30T19:00Z, 2026-10-29T19:00Z)`):
- **Seed for Agent A:**
  - leads: 5 in range (first moment open, last moment booked, 2 lost, 1 Meeting Done), plus one 1 s before the range, one at the end boundary, one deleted, and another agent's;
  - follow-ups: 2 done, 1 pending, 1 cancelled, 1 outside the range;
  - meetings: 2 completed in range (one at the last moment), 1 scheduled, 1 completed 1 s before the range;
  - sign-ins: 2 ins and 1 out in range, 1 in after it.
- **Result, exactly:** leads 5, open 2, booked 1, lost 2, win 33%, F/U 3 due, 2 done, 67%, meetings 2, sign-ins 2, sign-outs 1.
- **Agent B:** booked 1, win 100%, F/U % none.
- **Summary:** 3 agents, win 50%, F/U 67%. Outcome mix 2 / 2 / 2 = 6. Top closers B then A.

**Live data, browser vs SQL** (admin, default range 2026-09-29 → 2026-10-29):

| Agent | Open | Booked | Lost | Win % | Sign-ins | Sign-outs |
|---|---|---|---|---|---|---|
| Verify Agent | 2 | 1 | 1 | 50% | 10 | 4 |
| Dev Agent One | 1 | 0 | 0 | — | 2 | 1 |
| Dev Agent Two | 0 | 0 | 0 | — | 1 | 0 |

- Every figure matches an independent SQL query of the same records.
- Summary: "1 booked of 2 decided leads" = 50%; 13 sign-ins (4.3 per agent); Outcome mix 5 = 3 open / 1 booked / 1 lost.
- The range 1 Oct – 30 Nov picks up the completed meeting on 6 Nov (Meetings 1).

## 8. Tests and checks (all run 29 Oct 2026)

| Check | Result |
|---|---|
| Unit: default range, Pakistan-time boundaries, swap and clamp, invalid query fallback, pct, role matrix | 5 / 5 |
| PostgreSQL: all metrics with boundaries; scope per role (admin all / one team, manager own team, manager on another team → 403, agent own with the team ignored, HR and accountant → 403); contexts; inactive agents left out; manager with no team → 0 agents; sort with missing % last; default range; pagination; CSV | 4 / 4 |
| Full regression (all 10 modules) | **201 / 201**, 0 failed, 0 skipped (20 files) |
| `npm run typecheck`, `npm run lint`, `next build` | Pass (lint 0 problems; build 78 pages) |

**Browser** (built-in browser, real /login form for each role):

| Role | What was checked |
|---|---|
| **Admin** (`verify.admin`) | Numbers above. Filters drawer: "Performance filters / Scope, team, and date range. Changes apply immediately."; context All agents / Demo Sales Team / Verification Team (test) / VERIFY UI Team (inactive). Choosing the Verification team and To 2026-11-30: 1 agent, Meetings 1. Sorting by CRM sign-ins asc → desc (`aria-sort` descending). Export CSV: `text/csv`, `performance-2026-10-01-to-2026-11-30.csv`, rows match the table. |
| **Manager** (`verify.manager`) | 1 agent in scope (Verify Agent); context "My teams" / Verification Team (test) only; asking for another team → 403. |
| **Agent** (`verify.agent`) | Only their own row; context locked to "Your metrics"; a `team` URL or API parameter is ignored (context "own"). Sign-ins went up by 1 after the new login, so they are counted live. |
| **Super admin** (`verify.superadmin`) | Context "all", 3 agents |
| **HR** (`verify.hr`) | Access denied; API and CSV → 403; no sidebar link |
| **Accountant** (`verify.accountant`) | Access denied; API and CSV → 403; no sidebar link |

- **Responsive:** at 375, 768 and 1440 there is no horizontal page scroll and no clipped visible text; the table scrolls inside its own box.
- **Errors:** no app console errors; server log 0 errors and 0 5xx.

**Not checked:** opening the CSV in a spreadsheet program (its content was checked by fetching it); a range with more than 25 agents, so a second page (paging is covered by the integration test's page count only).

## 9. Limitations and unresolved client decisions

**Not available (no data or rule; shown as "—" with the reason, never estimated):**
- Calls and call minutes.
- Call quality: Verified ≥ 30 s and Qualified ≥ 60 s (FR-152 needs stored recording durations).
- Meaningful calls (AI score; AI call analysis is out of scope, Q-P4).
- Call volume leaders and Calls vs meetings.
- The **Critical** flag and the "Critical only" filter (Q-L8).
- Pipeline pressure (undefined).
- The roster's "Avg M / Avg QC".

**Attendance (Q-H2):** only CRM sign-in and sign-out counts are shown, labelled as authentication activity. No hours, days present or roster-based attendance is calculated.

**30 Oct 2026 (`PRODUCTION_READINESS_PLAN.md` §4):** the header now says "Agent KPIs and CRM sign-in activity for your scope", the table is "Performance & CRM sign-in activity", the sign-in glance and column tooltips say "not attendance", and a footnote states that sign-ins are not attendance plus the retention policy. This departs from the reference wording on purpose (C1).

**Inferred definitions:** P2–P11 in §1.4. Questions PQ1–PQ7 in §1.5 are open; none blocks use.
