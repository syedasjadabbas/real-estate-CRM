# Meetings Module (FR-100–102, FR-027 meetings bucket) — Plan and Implementation Record

Status: **implemented and verified 29 Oct 2026** (§9–§13).
- **Tests:** 172 / 172 pass; typecheck, lint and build are clean.
- **Browser:** checked for all six roles, at 375, 768 and 1440.
- **Open:** the assumptions in §1.3 still need client confirmation. Nothing is committed.

## Sources

**Documents:**
- `REQUIREMENTS.md`: FR-100, FR-101, FR-102, FR-027, FR-028.
- `MODULES_AND_FEATURES.md` §8.
- `USER_FLOWS.md` §7 and the lead pipeline diagram.
- `USER_ROLES_AND_PERMISSIONS.md`: Meetings F/F/T/O/—/—.
- `DATA_MODEL.md` §6 (meetings) and §4 (lead activity type `meeting`).
- `API_DESIGN.md` (Meetings).
- `UI_UX_SPECIFICATION.md`: S-14, status tones Scheduled = info, Completed = success, Cancelled = danger.
- `IMPLEMENTATION_ROADMAP.md` (P4).
- `TASKS_MODULE_PLAN.md`: patterns reused.

**Reference:** the SaleStorm `/dashboard/meetings` page was viewed **read-only** on 29 Oct 2026 as a Sales Agent. Nothing was created or saved. A live "Assigned to you" popup covered the Filters drawer and was not dismissed. Lead rows in the reference are not links, so the lead page was not opened.

---

## 1. Confirmed vs assumed

### 1.1 Confirmed (documented or observed)

| Item | Source |
|---|---|
| Fields: title, date-time, organizer, linked lead, status, notes | FR-100 |
| Statuses: Scheduled, Completed, Cancelled | FR-100, observed |
| List: search, status and organizer filters | FR-102, observed |
| Columns: Title, When, Organizer, Lead, Status, Updated (sortable) and Actions | Observed |
| Tiles: Total meetings ("All accessible"), Active filters, On this page ("Loaded rows"); "Page X of Y", page box, Go / Previous / Next | Observed |
| Empty state: "No meetings match" / "Try clearing filters or adjusting search." | Observed |
| Status changes: Scheduled → Completed or Cancelled | USER_FLOWS §7, API_DESIGN |
| Overdue meetings appear in To-dos | FR-027, USER_FLOWS §7 |
| A meeting counts as a lead "first touch" | FR-028 |
| Lead timeline has a `meeting` activity type | DATA_MODEL §4 |
| Roles: super admin and admin see all; manager sees the team; agent sees own; HR and accountant have none | Permission matrix |

### 1.2 Decisions, 29 Oct 2026 (your answers)

| # | Question | Decision |
|---|---|---|
| D1 | Completing a meeting (FR-101) | A checkbox, **"Also move lead to Meeting Done"**, ticked by default. Forward-only: the lead moves only from New Lead, Contact Attempted, Contacted, Qualified Lead or Meeting Scheduled. |
| D2 | Scheduling a meeting | A checkbox, **"Also move lead to Meeting Scheduled"**, ticked by default. Forward-only: the lead moves only from New Lead, Contact Attempted, Contacted or Qualified Lead. |
| D3 | Lead link | **Required** on every meeting |
| D4 | Where meetings are created | On the Meetings page **and** on the lead's detail page, for every role with Meetings access |

### 1.3 Assumptions (recorded, to confirm with the client)

| # | Assumption | Why |
|---|---|---|
| M-A1 | A meeting is "own" when the user is its **organizer or its creator**. A manager's team scope covers meetings organized or created by them or a team member. | Same open question as Tasks C1 |
| M-A2 | Organizer: agents can pick only themselves; managers themselves or their team; admins any active super admin, admin, manager or agent | Same as Tasks C2 |
| M-A3 | The actor must be able to open the lead being linked | Consistent with Tasks and Bookings |
| M-A4 | **End time** and **location** are optional fields. If an end time is given it must be after the start. | Proposed in DATA_MODEL (marked NEW); not seen in the reference |
| M-A5 | Completed and Cancelled are **final**: no reopening, and only Scheduled meetings can be edited | Documented flow has no way back |
| M-A6 | Completing or cancelling accepts an optional note, kept in the meeting history | Notes are in FR-100 |
| M-A7 | A meeting can be scheduled in the past, for example to log one that already happened. **Overdue** means Scheduled with a start time before now. | No rule documented |
| M-A8 | **Future Opportunity** and **Lost** leads are never moved automatically by D1 or D2; neither are Booking in Process or Booked | Forward-only guard; Future Opportunity sits off the forward path |
| M-A9 | The lead picker lists leads in the header project, plus the currently linked lead | Same as Tasks |

### 1.4 Not built (undocumented, per instructions)

- Recurring meetings.
- Reminders or notifications.
- Calendar or external integrations.
- Participants or attendees.
- Meeting "format": the dashboard mock-up mentions it, but no source defines it.
- Wiring the dashboard's meeting tiles; that dashboard work is separate.

## 2. Workflows

**List** (`/dashboard/meetings`):
- **Header:** the module header and a "Schedule meeting" button.
- **Tiles:** Total meetings, Active filters, On this page.
- **Toolbar:** search (title, lead name, lead code), a Filters drawer (Status, Organizer, "Overdue only") and Clear.
- **Table:** sortable columns and pagination (25 per page). An Overdue chip appears on Scheduled meetings that are past their start time.

**Create** (`/dashboard/meetings/new?lead=…`):
- **Fields:** title*, starts at* (Pakistan time), ends at, location, organizer* (defaults to the user), lead*, notes.
- **D2 checkbox:** shown with the lead's current stage. The note says when the lead won't be moved.
- **Lead page:** gets a "Meetings" panel listing that lead's meetings, with a "Schedule meeting" link.

**Detail** (`/dashboard/meetings/[id]`):
- **Facts:** when, organizer, creator, lead link, location, notes.
- **Status panel:** "Mark completed" (optional note plus the D1 checkbox) and "Cancel meeting" (optional note).
- **History:** every change, with who made it and when.

**Edit** (`/dashboard/meetings/[id]/edit`): the same fields as Create, for Scheduled meetings only, without the stage checkbox.

**To-dos:** a new "Overdue → Meetings" bucket.

## 3. Validation

- **Title:** 1–200 characters.
- **Starts at:** required and must be a valid date and time.
- **Ends at:** optional; if given, must be after the start.
- **Location:** optional, up to 200 characters.
- **Notes:** optional, up to 4000 characters.
- **Organizer:** must be an active user in an allowed role, and within the actor's assignable scope.
- **Lead:** required, must exist, not be deleted, and be visible to the actor.
- **Status changes:** use compare-and-set (`WHERE status = 'scheduled'`), so two people acting at once can't both succeed.

## 4. Permissions (enforced on the server)

| Action | Super admin | Admin | Manager | Agent | HR | Accountant |
|---|---|---|---|---|---|---|
| View | All | All | Team | Own | — | — |
| Create or edit (Scheduled only) | ✓ | ✓ | ✓ | ✓ | — | — |
| Complete or cancel | ✓ | ✓ | ✓ (team) | ✓ (own) | — | — |
| Pick organizer | Any | Any | Self or team | Self | — | — |

- **Out-of-scope records** return 404 rather than 403, so their existence isn't revealed.
- **Lead stage changes** caused by D1 or D2 use the same forward-only guard and the lead activity and audit trail as Bookings.

## 5. Database (additive migration `0007_meetings`)

- **Enum `meeting_status`:** `scheduled`, `completed`, `cancelled`.
- **`ALTER TYPE lead_activity_type ADD VALUE 'meeting'`** (documented in DATA_MODEL §4).
- **`meetings` columns:** id, title, starts_at, ends_at, location, organizer_id (FK users, restrict), lead_id (**not null**, FK leads, restrict), notes, status, completed_at, cancelled_at, created_by_id, created_at, updated_at.
- **`meetings` checks:** title not blank; `ends_at > starts_at` when set; `(status = 'completed') = (completed_at is not null)`; `(status = 'cancelled') = (cancelled_at is not null)`.
- **`meetings` indexes:** (organizer, status, starts_at), lead, creator, updated_at.
- **`meeting_history`:** create, update, organizer change, complete and cancel, with the actor. `audit_logs` also gets `meeting.*` entries.
- **Data safety:** no existing table is changed beyond the new enum value. Drift is checked before (`drizzle-kit check`) and after (`generate` should report no changes), and no data is reset.

## 6. API

- `GET/POST /api/v1/meetings`
- `GET/PATCH /api/v1/meetings/:id`
- `POST /api/v1/meetings/:id/complete` with `{ note?, moveLead? }`
- `POST /api/v1/meetings/:id/cancel` with `{ note? }`

## 7. UI

- **Reused:** the Tasks and Bookings components (page header, MiniStat tiles, Filters drawer, sortable table, pagination, FormSection fields, PanelCard and history list).
- **States:** loading via `loading.tsx` on every route; empty; validation errors on each field; success ("Meeting saved."); and error banners.
- **Layout:** checked at 375, 768 and 1440 px, and nothing should be clipped.

## 8. Tests

- **Unit:** policy matrix, stage-move guard, validation.
- **PostgreSQL integration:**
  - create, with lead touch and timeline entry;
  - the D2 move and its guard;
  - edit;
  - organizer scope;
  - lead access;
  - complete, with the D1 move and its guard;
  - cancel;
  - final statuses;
  - a concurrent status change;
  - list search, filters, sort and pagination;
  - overdue;
  - HR and accountant denied;
  - database constraints.
- **Browser:** real login-page sign-in; create, edit, complete and cancel; data kept after reload; agent, manager, admin, HR and accountant views; To-dos bucket; lead page panel; 375 / 768 / 1440.
- **Full regression:** Leads, Clients, Projects, Inventory, Bookings, Finance and Tasks, plus typecheck, lint and build.

---

## 9. What was built

| Area | Files |
|---|---|
| Schema | `src/server/db/schema.ts`: `meetingStatus`; `meetings`; `meetingHistory`; `meeting` added to `lead_activity_type` |
| Migration | `drizzle/0007_meetings.sql` (+ `drizzle/meta/0007_snapshot.json`, `_journal.json`) |
| Server | `src/modules/meetings/`: `constants.ts`, `policy.ts`, `validation.ts`, `commands.ts` (create / update / complete / cancel, forward-only lead moves), `queries.ts` (list, detail, form options, overdue, per-lead) |
| API | `src/app/api/v1/meetings/route.ts`, `[id]/route.ts`, `[id]/complete/route.ts`, `[id]/cancel/route.ts` |
| UI | `src/features/meetings/`: `actions.ts`, `url.ts`, `components/` (`meeting-pills`, `meetings-toolbar`, `meetings-table`, `meeting-form`, `meeting-status-panel`, `lead-meetings`) |
| Pages | `src/app/(app)/dashboard/meetings/`: `layout.tsx`, `loading.tsx`, `page.tsx`, `new/`, `[id]/`, `[id]/edit/` (each with `loading.tsx`) |
| Changed | `src/config/navigation.ts` (Meetings hidden from HR / accountant); `src/app/(app)/dashboard/leads/todos/page.tsx` ("Overdue → Meetings" bucket); `src/app/(app)/dashboard/leads/[id]/page.tsx` (Meetings panel + "Schedule meeting"); `src/features/leads/components/timeline.tsx` (meeting events); `tests/support/db.ts` (truncate list) |
| Tests | `tests/unit/meetings-rules.test.ts` (7), `tests/integration/meetings.test.ts` (10) |

## 10. Database and data preservation

- **Drift check before** the change: `drizzle-kit check` OK, and `generate` reported "No schema changes".
- **Migration `0007_meetings`** is additive only: a new enum, a new value on the existing enum, and two new tables. No existing column was changed.
- **Drift check after:** `check` OK and `generate` "No schema changes".
- **Row counts:**

| | Leads | Tasks | Bookings | Payments | Users | Meetings |
|---|---|---|---|---|---|---|
| Before | 4 | 4 | 3 | 6 | 11 | — |
| After | 5 | 4 | 3 | 6 | 11 | 3 |

  The one new lead is the test lead in §13; nothing was reset or deleted.

## 11. Tests (all run 29 Oct 2026)

| Suite | Result |
|---|---|
| Meetings unit (policy matrix, organizer scope, D1 / D2 forward-only guard, validation) | 7 / 7 |
| Meetings PostgreSQL integration (see below) | 10 / 10 |
| Full regression, by file | Leads 22 + 18, Clients 8 + 11, Projects 7 + 7, Inventory 7 + 10, Bookings 5 + 12, Finance 3 + 16, Tasks 11 + 18, Meetings 7 + 10 |
| Full regression, total | **172 / 172**, 0 failed, 0 skipped |
| `npm run typecheck`, `npm run lint`, `next build` | Pass (lint 0 problems; build 71 pages) |

**What the integration tests cover:**
- Scheduling: lead touch, timeline entry, history and audit.
- The D2 move and its guard across six stages.
- Validation: title, start, end, missing lead, a lead the actor can't open, organizer scope for agent, manager and admin.
- HR denied.
- Visibility scopes, with 404 outside scope.
- Editing, and the final statuses.
- D1 on, D1 off, and D1 blocked on Booking in Process.
- Concurrent complete and cancel: exactly one wins.
- Search, filters, sort, pagination, overdue, To-dos and the lead panel.
- Admin scope.
- Database constraints.

## 12. Browser checks (built-in browser, sign-in through the real /login form each time)

**Agent (`verify.agent`):**
- Created test lead "VERIFY Meeting Lead" (New Lead) through the Add lead form.
- Its lead page shows the Meetings panel (empty state, then "Schedule meeting →").
- The form opened with the lead pre-selected, the organizer limited to the agent, and the D2 checkbox ticked: "Currently New Lead".
- **Validation:** an empty submit showed "Title is required" and "Pick a date and time". An end before the start showed "End must be after the start".
- **Saved** "VERIFY Site visit with family" (5 Nov 15:00–16:00, site office, notes). After a reload, every field was there and the lead was **Meeting Scheduled**, with history "… lead moved to Meeting Scheduled".
- **Edited** the times (6 Nov 11:00–12:30). The edit form had no stage checkbox. History: "Updated end, start".
- **Second meeting, dated in the past** (28 Oct 10:00): the D2 checkbox was disabled with the reason "the lead is Meeting Scheduled…". The meeting showed the Overdue chip.
- **To-dos** showed "Meetings 1" with that meeting.
- **API filters:** search ("family", lead code), overdue and sort by title all returned the right rows.
- **Completed** the site visit with a note, D1 ticked: status Completed, lead **Meeting Done**, history "Completed · lead moved to Meeting Done · …".
- **Cancelled** the overdue meeting with a note: the "Meeting cancelled." confirmation showed, and the meeting left the To-dos bucket.
- **Lead timeline:** 4 meeting events and 2 stage changes. The lead panel listed both meetings.
- **Final statuses on the server:** `PATCH` on a cancelled meeting and a second `complete` both returned 422.

**Manager (`verify.manager`):**
- Sees the team agent's 2 meetings, with lead names.
- Organizer options are Verify Agent and Verify Manager only.
- Scheduled "VERIFY Manager-scheduled office meeting" with the agent as organizer.

**Admin (`verify.admin`):** sees all 3 meetings. Organizer options are every active super admin, admin, manager and agent (8). All 5 leads are offered.

**Super admin (`verify.superadmin`):** used for the responsive pass.

**HR (`verify.hr`) and accountant (`verify.accountant`):**
- No Meetings link in the sidebar.
- `/dashboard/meetings` and `/dashboard/meetings/new` show **Access denied**.
- List, detail, create and complete on the API all return **403**.

**Responsive (375 / 768 / 1440):**
- **Pages:** list, completed detail, scheduled detail, create form, edit form, the lead page with its panel, and the To-dos Meetings bucket.
- **Result:** no horizontal page scroll at any width, and no clipped visible text. The only hits were screen-reader-only labels, which are hidden by design. Wide tables scroll inside their own boxes.

**Errors:**
- **Console:** no app errors. The entries were dev hot-reload WebSocket drops from the restart, plus 403 and 422 responses from my deliberate permission and final-status probes.
- **Server log** (dev server restarted after the migration): **0 errors, 0 5xx**.

**Fixed during verification:** after completing or cancelling, the confirmation message disappeared, because the panel switched to its final state. It now stays visible (`meeting-status-panel.tsx`).

## 13. Test data left in the development database

- **Lead** "VERIFY Meeting Lead" (`1c999496-…`, code PTWGIHER, owner Verify Agent, test phone +92 300 5550123), now **Meeting Done**.
- **Meetings:**

| Meeting | Status | Notes |
|---|---|---|
| "VERIFY Site visit with family" (`55e31ee8-…`) | Completed | |
| "VERIFY Follow-up call (overdue)" (`c213eaab-…`) | Cancelled | |
| "VERIFY Manager-scheduled office meeting" (`0cb74a2d-…`) | Scheduled, 8 Nov 12:00 | Organizer Verify Agent, created by Verify Manager |

- **Meeting history:** 6 rows, with matching `audit_logs` and lead timeline entries.

## 14. Remaining concerns (not bugs found)

- **Dashboard:** its meeting widgets ("meetings by format", "Team meetings") are still not connected to real data. "Format" is undefined, so this was left alone (§1.4).
- **Performance and targets:** "meetings done" counts will come from this table once those modules are built.
- **Lead picker:** a native select, limited to 1000 leads in the header project. Large projects may need a search picker later; the same applies to Tasks.
- **Assumptions:** M-A1 to M-A9 (§1.3) still need client confirmation. None blocks use, and each can be changed without data migration.
