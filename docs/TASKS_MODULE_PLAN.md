# Tasks Module (FR-090–092, FR-009) — Plan and Implementation Record

Status: **implemented 29 Oct 2026.**
- **Verified:** tests, the live server, and the browser for all six roles (§7).
- **PDF output:** verified with Chrome's own print engine (§7.4).
- **Not verified:** the browser's interactive print dialog (§9).
- **Needs the client:** the business rules in §1.1, triaged in §1.2.

Meetings is now implemented; see `MEETINGS_MODULE_PLAN.md`.

Sources: `REQUIREMENTS.md` (FR-009, FR-090–092), `MODULES_AND_FEATURES.md` §7, `USER_FLOWS.md` §6, `DATA_MODEL.md` §6, `USER_ROLES_AND_PERMISSIONS.md` (Tasks F/F/T/O/—/—; proposal discount any/any/≤ manager cap/≤ agent cap), `API_DESIGN.md` (Tasks and proposals), `SYSTEM_ARCHITECTURE.md` (print routes), `UI_UX_SPECIFICATION.md` (task status tones, S-13). The SaleStorm Tasks page was viewed read-only on 29 Oct 2026 as a Sales Agent. Nothing was created or submitted there. A live "lead assigned to you" popup covered the Filters drawer and was left alone, so the documented filters were used: Status, Type, Assignee.

---

## 1. Confirmed, observed, assumed

| Item | Basis |
|---|---|
| Fields: title, type, status, due, assignee, lead, booking, description | FR-090, observed create form |
| Types: General, Payment plan printable, Proposal | FR-090, observed |
| Statuses: Open, In progress, Done, Cancelled | FR-090, observed |
| Columns: Title, Type, Status, Due, Assignee, Updated (sortable), Actions; KPI tiles Total tasks, Active filters, On this page; pagination | Observed |
| Filters: Status, Type, Assignee | MODULES §7. "Overdue only" was added for FR-092 |
| Builder: unit fills in area and price; total = area × price per sq ft; discount; down payment; N installments (default 36); editable rows; "Rebuild installment rows" | FR-091, observed |
| Agent's discount above the cap (5%) is rejected | FR-091 acceptance, observed help text |
| Default price per sq ft is used when a unit has no list price; ROI per year uses an ROI-per-sq-ft setting | Observed help text |
| Overdue tasks appear in To-dos | FR-092 |
| Roles: super admin and admin see all tasks, managers their team's, agents their own; HR and accountant have none | Permission matrix |

**Decisions, 29 Oct 2026** (your answers to the four questions):

| Question | Decision |
|---|---|
| Manager discount cap | A separate admin setting. While it is blank, managers use the agent cap. Admins may give any discount. |
| Down payment % and installment count | Admin settings (seeded with 30% and 36). Agents can't change the down payment %, but managers and admins can. Anyone can change the installment count. |
| Due dates on schedule rows | None. Rows are #, Installment, Description, Progress and Amount, as in the reference. |
| Printed proposal | Data sections only. Sections with no documented content (bonuses, why act now, next steps) print only what the user writes, and are left out when blank. |

### 1.1 Business rules still needing client confirmation

The code follows the "Current behaviour" column. It has **not** been changed silently, and no values were invented. Each row is a rule I chose because no document defined it, or a value still pending Q-B6.

| # | Topic | Current behaviour | Basis | What to confirm |
|---|---|---|---|---|
| C1 | **Task ownership and visibility** | A task is "own" when the user is its **assignee or its creator**. Super admin and admin see all; a manager sees tasks assigned to or created by themselves or a team member; an agent sees their own. HR and accountant have no access. | Matrix row "Tasks F/F/T/O/—/—"; "own" undefined | Is a task "own" by assignee only, or also by creator? |
| C2 | **Who can be assigned** | Agents: only themselves. Managers: themselves or their team. Admins: any active super admin, admin, manager or agent. | Not documented | Can agents assign to teammates? Can HR or accountants be assignees? |
| C3 | **Status changes** | Any status can change to any other. A cancelled task can't be edited until it is reopened. | Not documented | Any transitions to block, such as reopening Done? |
| C4 | **Rounding remainder** | Leftover paisa goes on the **last** installment row. Row 1 is "Down payment", then "Installment 1…N" with the recurring label as the description. | Not documented | Remainder on the first or last row, or whole rupees only? |
| C5 | **Default discount** | The builder starts at **0%**. The reference showed 5 for an agent, but nothing says the default equals the cap. | Observed, ambiguous | Should the default be 0%, or the user's cap? |
| C6 | **Edited rows vs proposal total** | If edited rows don't add up to the sale value after discount, the form **warns but still saves**. | Not documented | Must edited rows equal the total, and should saving be blocked otherwise? |
| C7 | **Discount caps** | Agent 5% (observed, seeded). Manager cap blank, so managers use the agent cap. Admins have no cap. | Q-B6 | The final agent cap, and the manager cap |
| C8 | **Down payment %** | 30% (observed, seeded). Agents can't change it; managers and admins can. | Q-B6 | The final % and who may change it |
| C9 | **Installment count** | 36 (documented default, seeded). Anyone can change it per proposal. | Q-B6 | Final default and any limits |
| C10 | **Default price per sq ft** | **Not set.** A unit with no list price gives no total and no schedule. | Q-B6 | The value, or "units must have a list price" |
| C11 | **ROI per sq ft** | **Not set.** The ROI field shows "ROI per sq ft not set". | Q-B6 | The value, or drop ROI |
| C12 | **Snapshot on save** | A saved plan keeps its unit price and ROI rate while the unit stays the same. Agents keep the saved down payment %. Settings changes affect proposals saved afterwards. | FR-009 acceptance, interpreted | Should existing proposals ever re-price? |
| C13 | **Unit status** | Any unit can be picked, including booked or reserved ones; the status is shown in the picker. | Not documented | Limit proposals to available units? |
| C14 | **Printed proposal** | Data sections only. Bonuses, Why act now and Next steps print only what the user writes. | Decision 29 Oct 2026; layout pending | The final layout and fixed wording |

### 1.2 Triage of C1–C14 (reviewed 29 Oct 2026; no rule changed)

**Confirm before proposals go to real customers.** These affect the money or the content of the document a customer receives:

| # | Why |
|---|---|
| C7 | Final discount caps: the current 5% agent cap is observed but not confirmed |
| C8 | Down payment %: 30% is seeded and drives every schedule |
| C10 | Default price per sq ft: unset, so units with no list price produce no total |
| C14 | Printed layout and fixed wording |
| C4 | Rounding: the current rule gives exact totals, but the client may expect whole rupees or the remainder on the first row |
| C6 | Edited rows vs total: a warning only, so a schedule that doesn't add up can still be printed |

**Safe to leave pending or configurable.** The current behaviour is consistent, reversible, and configurable or easy to change:

| # | Why |
|---|---|
| C1 | Ownership |
| C2 | Who can be assigned |
| C3 | Status changes |
| C5 | Default discount (0%) |
| C9 | Installment count: a setting |
| C11 | ROI per sq ft: a setting; ROI is hidden while it is unset |
| C12 | Snapshot on save |
| C13 | Unit status in the picker |

None of these block other modules, Meetings included.

**Implementation details, not business rules:**
- A linked lead or booking outside the viewer's access isn't named; it shows as "Linked (outside your access)", and editing keeps it.
- The lead and booking pickers list the header project's records, plus whatever the task already links.

## 2. Proposal vs Finance

The schedule is a **proposed plan only**:
- It is stored in `task_installment_rows`, with no foreign key to payments or Finance.
- It is never used for Finance's outstanding or overdue figures.
- Saving or rebuilding a plan never touches `booking_payments`; an integration test checks this.
- There is no second ledger.

## 3. Database (migration `drizzle/0006_tasks.sql`, additive only)

- **Enums:** `task_type`, `task_status`.
- **`tasks`:**
  - `proposal` is a jsonb snapshot.
  - Checks: title not blank; `(type = 'general') = (proposal is null)`; `(status = 'done') = (completed_at is not null)`.
  - Indexes: assignee/status/due, creator, lead, booking, updated.
  - Foreign keys `restrict` on users, leads and bookings.
- **`task_installment_rows`:** unique (task, seq), seq > 0, amount ≥ 0; cascades with its task.
- **`task_history`:** create, update, assign, status, plan and rebuild entries, with the actor. Every change also writes `audit_logs` (`task.*`).
- **`app_settings`** (FR-009): key/value table, seeded `ON CONFLICT DO NOTHING` with agent cap 5, down payment 30, installments 36. Setting changes are audited (`app.setting`).
- Applied to the development database. `drizzle-kit check` reports no issues and `drizzle-kit generate` reports "No schema changes" (no drift). No data was reset or deleted.

## 4. Code

- **`src/modules/tasks/`:**
  - `constants`, `policy`, `validation`, `support` (full-path field errors such as `proposal.discountPct` and `rows.3.amount`);
  - `plan` (pure paisa arithmetic, shared by the builder preview and the server);
  - `settings`, `commands` (`createTask`, `updateTask`, `setTaskStatus`, `rebuildInstallments`);
  - `queries` (`listTasks`, `getTaskDetail`, `taskFormOptions`, `assignableUsers`, `overdueTasks`).
- **The server recomputes every figure** and enforces the role scope, the assignee scope, link access (and that a booking matches its lead), the discount cap and the agents' down-payment lock.
- **API:**
  - `GET/POST /api/v1/tasks`;
  - `GET/PATCH /api/v1/tasks/:id`;
  - `POST /api/v1/tasks/:id/status`;
  - `POST /api/v1/tasks/:id/installments/rebuild`;
  - `GET/PATCH /api/v1/tasks/settings`.
- **UI** (`src/features/tasks/`, pages under `src/app/(app)/dashboard/tasks/`), built from the existing Leads, Bookings and Finance components:
  - list: tiles, search, Filters drawer, sortable table, pagination;
  - create and edit (`/new`, `/[id]/edit`), with the builder sections 01–06, a live preview and editable rows;
  - detail (`/[id]`): status buttons, plan table, rebuild button, history;
  - `/settings` (admins);
  - print page `/print/proposal/[id]` (A4, "Print / Save as PDF").
  - Every new route has a `loading.tsx`.
- **To-dos:** a new "Overdue → Tasks" bucket. The old "task reminders join later" note now mentions meetings only.
- **Navigation:** Tasks is hidden from HR and accountants, who have no access.

## 5. Tests (all run 29 Oct 2026)

| Check | Result |
|---|---|
| `tests/unit/tasks-rules.test.ts` (policy, caps, plan arithmetic, rounding, validation) | 11 passed |
| `tests/integration/tasks.test.ts` (PostgreSQL: roles, scope, assignment, links, builder, caps, down-payment lock, settings snapshot, edited rows and rebuild, default rate, status, type switch, reassignment, overdue, search/filter/sort/pagination, settings audit, no Finance side effects, DB constraints) | 17 passed |
| Full regression suite (all modules) | 154 / 154 passed (14 files) |
| `npm run typecheck`, `npm run lint`, `next build` | Passed |

## 6. Live server checks (curl, real sessions, dev server restarted after the migration)

| Role | `GET /api/v1/tasks` | Tasks page | `PATCH /api/v1/tasks/settings` | Settings form shown | To-dos `?bucket=tasks` |
|---|---|---|---|---|---|
| Super admin | 200 | 200 | 200 | yes | 200 |
| Manager | 200 | 200 | 403 | no | 200 |
| Agent | 200 | 200 | 403 | no | 200 |
| HR | 403 | 200 (Access denied) | 403 | no | 200 |
| Accountant | 403 | 200 (Access denied) | 403 | no | 200 |

The browser pane showed the accountant's Access denied page.

## 7. Browser checks (built-in browser, 29 Oct 2026, verification accounts, with your go-ahead)

**How sessions were started:**
- **Pass 1** (agent, manager, super admin): from the page, through the app's own `POST /api/v1/auth/login`.
- **Pass 2** (manager, HR, accountant, super admin): through the real **/login form**, logging out between roles with the **Log out** button.
- No session token or cookie was copied anywhere.

### 7.1 Pass 1

**Agent (`verify.agent`):**
- Tasks shows in the sidebar.
- The list's empty state reads "No tasks yet. Create one to get started."
- Submitting an empty form shows "Title is required".
- **General task:** created with a past due date and the lead VERIFY Test Lead One. The detail page shows "Task saved.", the Overdue chip, the linked lead and a "Created" history entry. It appears under To-dos → Overdue → Tasks with a count of 1.
- **Proposal, unit VERIFY-S1** (500 sq ft at a list price of PKR 9,000,000):
  - The form shows PKR 18,000 per sq ft. Down payment % is read-only at 30%. The ROI field shows "ROI per sq ft not set".
  - **At a 6% discount** the preview showed PKR 8,460,000 after discount, 2,538,000 down and 164,500 × 36, with 37 rows. Saving was **refused** with "Your discount limit is 5%".
  - **At 5%,** with the row 2 progress note edited by hand ("Rows edited by hand", Rebuild enabled), it saved.
- **After a reload:**
  - 37 rows, a total of PKR 8,550,000, and the edited note still on row 2.
  - **Rebuild** ("Rebuilt 37 rows.") cleared the edited note.
  - **In progress** was set, and the history listed both actions.
- **Print page:** shows the cover, Project Overview, Investment Summary and Payment Schedule. Empty optional sections are left out.
- **List:** the type filter, title sort (`aria-sort`), filter badge, tiles, Filters drawer (Status, Type, Assignee, Overdue only, Clear filters, Done) and search / status / overdue / "assigned to me" filters all gave the right rows.
- **Edit:** the title changed and saved. The unchanged lead link stayed. "Done" took the task out of the overdue list.

**Manager (`verify.manager`):**
- Sees both of the team agent's tasks.
- In the builder the down payment % can be edited, the assignee list is limited to their team (agent and self), and their discount limit is 5% because the manager cap is unset.
- Reassigning the proposal to the manager recorded "Reassigned: Verify Agent → Verify Manager" and "Plan saved…" in the history.

**Super admin (`verify.superadmin`):**
- Sees all tasks and the "Proposal settings" button.
- Settings validation: an agent cap of 150 shows "must be between 0 and 100".
- Saving without changes shows "No changes to save." No setting values were changed.

**Accountant:** sees Access denied on Tasks.

**Layout:** at 375, 768 and 1440 the list, detail, create/edit builder, settings, print and To-dos pages have no horizontal page scroll; the wide tables scroll inside their own boxes. Clipped money values were not checked in this pass; see §7.2.

**Errors:**
- Console: no app errors. The only entries were dev hot-reload WebSocket drops from the server restart.
- Server log: no errors and no 5xx responses.

**Note:** after a client-side navigation, Next 16 keeps the previous page mounted but hidden. That's why the detail page's DOM briefly also contained the edit form's table. It is not a duplicate on screen.

### 7.2 Pass 2 (second verification request)

**Lead and booking links (super admin):**
- Lead "VERIFY Booking Lead A" with booking VERIFY-B201, which belongs to lead B, was **refused** with "This booking belongs to a different lead".
- With its own booking VERIFY-A101, it saved.
- The detail page shows both links. Clicking the booking link opened `/dashboard/bookings/67e8d224-…`.

**Manager:**
- `/dashboard/tasks/settings` shows **Access denied**.
- The list has no "Proposal settings" button but does have "Create task".
- Tasks is in the sidebar.
- The list shows only the 2 team tasks. The super admin's own task is out of scope and not listed.

**HR (`verify.hr`):**
- **Tasks is not in the sidebar.** The links present were Dashboard, Leads, Clients, Projects, Inventory, My workplace, HR, Targets, Teams, Bookings, Meetings and Performance.
- `/dashboard/tasks` and `/dashboard/tasks/f43002e5-…` show **Access denied**. `/print/proposal/f43002e5-…` returns **404**.
- `GET /api/v1/tasks`, `GET /api/v1/tasks/:id` and `GET /api/v1/tasks/settings` return **403**.

**Accountant (`verify.accountant`):**
- **Tasks is not in the sidebar** (Finance is, as expected).
- `/dashboard/tasks/new` shows **Access denied**.
- `GET /api/v1/tasks` and `GET /api/v1/tasks/settings` return **403**.

**Clipped money values: one defect found and fixed.**
- At 375 px the detail page's summary tiles and the builder's step 03 tiles cut off "PKR 8,550,000" and "PKR 2,565,000". They sat two per row and truncated.
- Fix: one tile per row on phones (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`), in `src/app/(app)/dashboard/tasks/[id]/page.tsx` and `src/features/tasks/components/task-form.tsx`. Finance's record form uses the same pattern.
- Re-checked at 375, 768 and 1440 on detail and edit, and at 375 on print: no clipped money values (a script compared each value's text width with its box), and no horizontal page scroll.

**Errors:**
- **Console:** dev hot-reload WebSocket drops, plus 5 × 403 from my deliberate HR and accountant API probes. No app errors.
- **Server log:** no errors and no 5xx responses.

**Regression after the fix:** 154 / 154 tests, typecheck, lint and `next build` all pass.

### 7.3 Admin role (pass 3, with your approval)

**Account.**
- `verify.admin@mz.local` ("Verify Admin", role `admin`) was created with the same development pattern as the other verification accounts: a scratch script hashes the existing verification password with argon2, inserts the user with `ON CONFLICT DO NOTHING`, and appends a line to `.dev-credentials` without the password.
- It is not added to any team.
- Sign-in was through the real **/login** form.

**What admin is meant to have.** In the code, `admin` has exactly the same Tasks permissions as `super_admin`: the matrix row "Tasks F/F", and FR-009 says "Admin 'App settings'". So **Tasks has no super-admin-only controls.** The super-admin-only controls that do exist are in Finance (proposed matrix "Accounts & Finance F/R"): recording payments, requesting reversals, Finance settings and payment methods. Those were used as the negative check.

| Check (as Verify Admin) | Result |
|---|---|
| Sidebar | Tasks and Finance present |
| Task list | All 3 existing tasks, including the super admin's and the agent's. "Create task" and "Proposal settings" buttons shown |
| Create proposal | Assignee list offers every active super admin, admin, manager and agent (8 users). Down payment % editable. Discount limit shows 100%. Unit VERIFY-S1 at **20%** discount, **25%** down, **12** installments: 9,000,000 → 7,200,000; 1,800,000 down; 450,000 × 12; 13 rows; total 7,200,000 (matches a hand calculation). Saved with assignee Verify Agent and creator Verify Admin |
| Edit a task created by the super admin | Title changed, then status set to In progress. Both kept after a reload, with history entries "Updated title" and "Status: Open → In progress" by Verify Admin. Lead and booking links kept |
| Print page | "Exclusive Investment Proposal", Project Overview, Investment Summary, Payment Schedule (13 rows, total PKR 7,200,000), Print button |
| Proposal settings | Page opens with all inputs enabled. Installment count 0 is refused with "At least 1". Saving without changes shows "No changes to save.". `PATCH /api/v1/tasks/settings {}` returns 200. **No setting values were changed** (the dev DB still holds 5 / 30 / 36) |
| Finance UI (super-admin-only parts) | Tabs show Payments, Reversal approvals, Outstanding and Settings, with **no Record payment tab**. `/dashboard/finance/record` shows **Access denied**. Finance settings is **read-only** (inputs disabled, no save buttons) |
| Finance API (super-admin-only parts) | `POST /finance/payments`, `POST /finance/payments/:id/reversal-requests`, `PUT /finance/settings` and `POST /finance/payment-methods` all return **403** "You do not have permission to do that.". `GET /finance/payments` and `GET /finance/reversal-requests` return 200 |
| Console and server | No app errors. The server log has no errors and no 5xx responses |

**Differences found:** none. Admin behaves the same as super admin in Tasks, and is blocked from the super-admin-only Finance controls in both the UI and the API.

**Not checked:** user and role management. That module isn't built yet, so there was nothing to test there.

**Regression after this pass:** a new integration test covers the admin role in Tasks (sees all tasks, any assignee, no discount cap, editable down payment, settings). The suite now has **155 / 155** tests; typecheck, lint and `next build` pass.

### 7.4 Print / PDF (pass 4)

**How it was tested.**
- **No print dialog:** the browser's interactive print dialog wasn't opened. It is a native window that would freeze browser automation.
- **Real PDF instead:** Chrome's own print engine (DevTools Protocol `Page.printToPDF`, the engine behind "Save as PDF") produced real PDFs.
- **Setup:** a throwaway headless Chrome profile on A4 with 0.4" margins and backgrounds on. It signed in as `verify.agent` through the real **/login** form.
- **Scratch only:** the script and PDFs are in the session's scratch folder, not the project.
- **Workarounds needed:** the protocol had to run over pipes, because a debugging port was unreachable in this environment, and the profile needed a short path, because long ones make Chrome exit.

**Proposals printed:**
- `f43002e5-…`: 36 installments, 37 rows.
- `f4a65df5-…`: 12 installments, 13 rows.

**Print styles confirmed in print mode:**
- The toolbar (Back / Print) is `display: none`.
- The grey page background turns white.
- The card shadow is removed.
- No sidebar or app header.
- No clipped text, and no console errors.

**Content checked in the PDFs:**
- Project, client and customer, apartment no and area.
- Price per sq ft 18,000; total 9,000,000.
- **Discount 5% → 8,550,000**; **down payment 30% → 2,565,000**; **36 × 166,250**.
- All 37 rows; **total 8,550,000**.
- The second proposal: 20% / 25% / 12 → 7,200,000; 1,800,000; 12 × 450,000.

**Print layout defects found in the first PDF, and fixed** (`src/app/print/proposal/[id]/page.tsx`, layout only, no figures touched):
1. **Page 1 was two-thirds blank.** The whole Payment Schedule section was marked "don't split", so it jumped to page 2. It may now break across pages, with its heading kept above the first rows.
2. **"Total" printed at the bottom of page 2** while rows 33–37 were still on page 3, because browsers repeat a table footer on every page. The footer now prints once, at the end.
3. **A large grey block on the last page.** The grey app background printed. The page background is now forced white in print.

**After the fixes:**
- The 37-row proposal is **2 pages**: the schedule starts on page 1, column headings repeat on page 2, and Total appears once at the end.
- The 13-row proposal fits on **1 page**.
- No blank pages, no app chrome, no missing amounts.

## 8. Test data

**Development database** (nothing reset or deleted):
- "VERIFY Call back about budget (edited)" (`3859cb5f-…`): General, Done.
- "VERIFY Proposal for Test Lead One" (`f43002e5-…`): Proposal, In progress, assigned to Verify Manager, unit VERIFY-S1.
- "VERIFY Send booking form (admin edit)" (`3e0852b0-…`): General, In progress, created by Verify Super Admin and edited by Verify Admin, linked to VERIFY Booking Lead A and booking VERIFY-A101.
- "VERIFY Admin proposal" (`f4a65df5-…`): Proposal, Open, created by Verify Admin, assigned to Verify Agent, unit VERIFY-S1, 20% / 25% / 12.
- User `verify.admin@mz.local` (role `admin`, temporary test account). To remove it later, deactivate it rather than delete it, since history rows reference it.
- The three seeded `app_settings` rows are unchanged.
- No Finance records were created.

**Integration tests:** they use the separate test database (`TEST_DATABASE_URL`), which is truncated between tests.

## 9. Pending

| Check | Why pending |
|---|---|
| The browser's interactive print dialog and a physical printer | The PDF output was verified with Chrome's print engine (§7.4), but the native dialog can't be driven from automation, and no printer is attached |
| Client confirmation of §1.1 (C1–C14) | Business decisions |

## 10. Client confirmations of 10 Nov 2026 (FR-091, FR-009)

The client confirmed the proposal rules in writing on 10 Nov 2026 (`PROJECT_STATUS.md` §56). Each one, against the code on 11 Nov 2026:

| Rule | State | Where |
|---|---|---|
| Anyone can own a proposal; only the Super Admin edits a saved one (Q36) | **Implemented now.** A task that has a saved plan (Proposal or Payment plan printable) can only be edited by the Super Admin: fields, plan, rows, type and "Rebuild installment rows". The owner, their manager and Admins can still change its status. An Admin can still reassign it (Q45), as long as nothing else changes. The task page hides Edit and Rebuild and says why; the edit page refuses. | `policy.ts` (`canEditSavedProposal`, `canEditTaskDetails`), `commands.ts` (`updateTask`, `rebuildInstallments`), `queries.ts` (`canEditDetails`), task and edit pages |
| Default discount 0%; mismatched rows save with a warning (Q38, Q39) | Already done (C5, C6) | `validation.ts`, task form |
| Agent and Manager discount limit 5% (Q40, Q41) | Already done: agent cap 5 (migration 0006), manager cap 5 (migration 0014) | `policy.ts` `discountCap`, settings |
| Default down payment 25% (Q42) | Already done: migration 0014 and the code fallback | `constants.ts`, migration 0014 |
| Installments due on the 10th (Q43) | Already done. **The first installment month is still chosen on the form**: the client's answer gives the down payment's date (7 days after booking, for overdue) but not which month the first installment falls in (C-27), so the behaviour is unchanged. | `plan.ts` |
| Rounding difference on the final installment (Q37) | Already done (C4) | `plan.ts` `buildRows` |
| Floor rates GF 10,824, FF 9,593, SF 8,624 per sq ft (Q44) | **Implemented now** as three admin settings (`proposal.floor_price_per_sqft.gf/ff/sf`) with these defaults. No migration: a missing row means the default; clearing one stores a blank row ("not set"). A floor rate is used only when the unit has no list price of its own (C-28 did not say they override unit prices or which projects they cover), then the default price. A unit's floor text matches a code case-insensitively: GF / Ground / Ground floor, FF / First / 1st (floor), SF / SS / Second / 2nd (floor). Changes are audited. | `constants.ts`, `plan.ts` `unitPricePerSqft`, `settings.ts`, settings form |
| Only available units (Q48) | Already done | `commands.ts` `resolveProposal`, task form |
| Saved proposals reflect unit price changes (Q47) | Already done (automatic sync and reconciliation). A floor-rate change shows up in the reconciliation report and on the task page; it isn't pushed into saved proposals automatically. | `price-sync.ts` |
| Admin and Super Admin assign tasks (Q45) | **Implemented now** (the removal half). Managers and agents can no longer assign to anyone else; they still create tasks for themselves, because C-29 hasn't answered that. The list's Assignee filter still offers the people whose tasks they can see. | `policy.ts` `canAssignTo`, `queries.ts` |

**Still open:** C-25 (may an owner correct a proposal before printing?), C-27 (first installment month), C-28 (projects covered by the floor rates, ROI rate), C-29 (self-tasks), C-31 (keep a printed copy). A unit's floor change doesn't trigger the proposal sync (only price and area changes do; that rule lives in Inventory).

**Tests:** `tests/unit/tasks-rules.test.ts` (assignment, Q36 lock, floor rates and codes, settings validation); `tests/integration/tasks.test.ts` (updated for Q36 / Q45, plus "client confirmations of 10 Nov 2026"); `e2e/questionnaire-screens.spec.ts` (agent sees no Edit after saving). Integration and Playwright runs are pending: the shared test database was in use.
