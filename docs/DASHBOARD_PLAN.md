# Dashboard — implementation notes

Status: **FR-010, FR-011, FR-012, FR-013 (tiles), FR-015 and FR-016 wired to PostgreSQL, 31 Oct 2026.** The aging matrix (FR-014) is not built. The metric definitions below are the implementer's reading of the reference and `REQUIREMENTS.md`; **the client has not confirmed them**.

Sources: `REQUIREMENTS.md` §1 (FR-010 to FR-016), `MODULES_AND_FEATURES.md` §1, the existing dashboard view (`src/features/dashboard/*`, previously fed empty data).

Code:
- `src/modules/dashboard/queries.ts` (`dashboardData`, `rangeBounds`)
- `src/app/(app)/dashboard/page.tsx`
- `executive-essentials.tsx`: range and team controls now change the URL
- `recent-leads.tsx`: rows link to the lead
- `dashboard-hero.tsx`: data status

## 1. Scope

- **Project:** the header's active project. Top projects is the exception and compares the projects the user can see.
- **Leads:** the user's lead scope, the same rules as the Leads list. Agents see their own leads, managers their teams', admins and super admins everything. Deleted leads are excluded.
- **HR and accountants:** they have no lead access, so they keep the empty-state dashboard ("No lead analytics for your role").
- **Team filter** (`?team=`):
  - Admins can pick any active team; managers only the teams they manage. Any other value is ignored.
  - A team means leads owned by that team's members.
  - Agents get no team choices.

## 2. Date ranges (FR-011) — `?range=24h|7d|30d|mtd|6m|custom&from=&to=`

| Range | Window |
|---|---|
| 24h / 7d / 30d | Rolling, ending now |
| MTD (default) | From the 1st of the current month, 00:00 Pakistan time, to now |
| 6m | Rolling six calendar months |
| Custom | `from` 00:00 to the end of `to`, Pakistan time. If either date is invalid, or `from` is after `to`, it falls back to MTD. |

KPIs, lead sources, inbound channels and top projects count **leads created in the window**. For a custom range, the total equals the Leads list with the same From / To dates (covered by a test).

## 3. Formulas (to be confirmed by the client)

| Widget | Formula |
|---|---|
| Total leads | Leads created in the window |
| Open / Won / Lost % | Share of the total in open stages / Booked / Lost |
| Conversion rate | Won ÷ total |
| Win on decided | Won ÷ (won + lost) |
| Open pipeline | Count and share of the total still open |
| Attrition rate | Lost ÷ (won + lost) |
| Regenerated | Leads in the window flagged as re-inquiries |
| Awaiting first touch | Open leads in the window with no first touch yet |
| Stale pipeline | Open leads in the project with no update for 14+ days (FR-013 acceptance). Not limited to the window. |
| No meeting (window) | Open leads with no non-cancelled meeting in the last 30 days |
| Meetings done | Completed meetings in the last 30 days on leads in scope |
| Recent leads | Latest 20 leads in the project, whatever the range. A click opens the lead. |
| Top projects | Top 5 projects by leads created in the window, across the projects in scope |
| Active projects | Projects with status "active" |
| Lead sources / Inbound channels | Leads in the window grouped by source / channel |

## 4. Not wired (empty states kept)

| Widget | Why |
|---|---|
| Aging vs meetings matrix (FR-014, low priority) | The age and meeting buckets and the "engaged pipeline" exclusion rule aren't defined well enough to count. |
| Instant insights: team score, average score, team output, meeting mix, targets | "Score" and meeting "format" are not defined in any document (`MEETINGS_MODULE_PLAN.md` §M). The targets view belongs to the Targets module. |

## 5. Tests

`tests/integration/dashboard.test.ts` (8):
- KPI values for an admin;
- the total equals the Leads list (admin, manager, agent);
- agent, manager, HR and accountant scopes, and no project;
- the team filter is limited to the user's own teams;
- the ranges and their fallbacks;
- pipeline-health tiles;
- Pakistan-time bounds;
- deleted leads are excluded.

A bug found while testing was fixed in the "no meeting" subquery: Drizzle leaves columns unqualified in single-table queries, so the lead id is now written out in full.

## 6. Lost leads by reason and by team (FR-016), 31 Oct 2026

- **Which leads:** those **created in the selected range and now Lost**, in the same scope, project and team filter as the KPI tiles. The reason totals add up to the "Lost" figure on the Won / Lost tile (covered by a test).
- **By reason:**
  - Grouped by the recorded lost reason; leads with no reason appear as "No reason recorded". That row is **not** a link, because the Lost list cannot filter for a missing reason. This was found in browser QA: the link had opened every lost lead.
  - A click opens the Lost list (`/dashboard/leads/lost?lostReason=…&from=…&to=…`) for the same reason and days. The Lost list gained a `lostReason` filter for this, and it is included in "Clear filters".
  - The Lost list filters by whole days, so a rolling 24h / 7d / 30d range opens the matching calendar days.
- **By team:**
  - Grouped by the **lead owner's** active teams, and each team expands to its agents.
  - Owners in several teams are counted under each team; owners in no team, and unassigned leads, appear under "No team".
- **Tests:** `tests/integration/dashboard.test.ts` (now 9):
  - the totals reconcile with the Lost tile;
  - the click-through total equals the filtered Lost list;
  - agent scope;
  - the "No team" bucket.

**Open questions:**
- D1: should an owner in several teams count once (under which team?) rather than under each?
- D2: should "lost in range" use the date the lead was marked lost instead of the date it was created? The current choice matches the KPI tiles.

## 7. Aging vs meetings matrix (FR-014): blocked on definitions (31 Oct 2026)

**What is known:**
- From the reference capture (`MODULES_AND_FEATURES.md` §1 and the observed layout kept in `sample-data.dev.ts`):
  - **Rows:** lead-age bands 0–1M, 1–2M, 2–3M, 3–5M, 5–8M, 8–12M, 12M+.
  - **Columns:** the number of leads with 0–1, 2–5, 6–10, 11–20 or 20+ meetings, then Leads (the row total), Meetings and Avg / owner.
- The widget text says: "Engaged pipeline matrix (excludes unengaged imports). Meetings = calendar completed + pipeline meeting-done."
- The source data exists: lead `created_at`, `stage` and owner; meetings with status and time.

**Not defined anywhere (needs the client, M-Q1 to M-Q5):**

| # | Question | Why it matters |
|---|---|---|
| M-Q1 | Which leads form the "engaged pipeline"? What is an "unengaged import", and are lost / booked leads included? | Decides every row |
| M-Q2 | How are meetings counted per lead: completed calendar meetings only, plus one for a lead at "Meeting done" with no calendar meeting, or both (double counting)? | Decides the bucket of each lead and the Meetings column |
| M-Q3 | Are meetings counted for the whole lead lifetime or only inside the 30-day window? | Changes the counts |
| M-Q4 | Is a "month" 30 days or a calendar month? Are band edges inclusive? | Moves leads between rows |
| M-Q5 | Avg / owner: meetings ÷ distinct owners in the row, or ÷ all owners in scope? | The column value |

**Current state:**
- The pipeline-health tiles (stale, no meeting, meetings done) are live.
- In place of the matrix, the card says the matrix is waiting for these definitions. The dev preview keeps the observed sample layout.
- The existing `AgingRow` type and table rendering are ready. Once M-Q1 to M-Q5 are answered, only the query in `src/modules/dashboard/queries.ts` (and its tests) needs to be written.
