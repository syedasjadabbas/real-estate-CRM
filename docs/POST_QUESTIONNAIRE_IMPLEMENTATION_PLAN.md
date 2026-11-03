# Post-questionnaire implementation plan

Prepared 2 Nov 2026. **Plan only: nothing here has been implemented.** Development starts only after Zeploy Tech approves this plan and the client signs the questionnaire (S-1).

Companion documents:
- `CLIENT_ANSWERS_RECONCILIATION.md`: each of the 53 answers against current behaviour.
- `REMAINING_CLIENT_CLARIFICATIONS.md`: questions S-1, C-1…C-33 and the older open list (D).
- `CHANGE_REQUESTS.md`: additional scope (CR-1 commercial decision, CR-2, CR-3; CR-4 to CR-6 reclassified in scope on 2 Nov).

**Labels used throughout.**
- **Approved:** the client's answer states it clearly. Still subject to signature S-1.
- **Assumption:** our reading of a partial answer. Not built until confirmed; the C-ID is given.
- **Unresolved:** can't be built without an answer.

**Ground rules for all work.**
- Existing records and functionality are preserved.
- Migrations are additive only: new tables, new nullable columns, new enum values, and relaxing a NOT NULL. There are no drops, renames or data rewrites, and the dev database is never reset.
- Sign-in behaviour is unchanged.
- Every permission removal is audited and shipped with tests proving both the new refusal and the remaining access.

---

## 1. Classification

### A. Clear requirements within the existing quotation

| Ref | Requirement | Label |
|---|---|---|
| Q1 | HR keeps records for staff without CRM logins | Approved |
| Q2 | Admin and Super Admin create and deactivate CRM accounts | Approved (C-1 for Super Admin accounts) |
| Q3 | Deactivation is manual, with a lead-shift option | Approved; shift scope C-2 (formerly CR-5, now in scope, after V1) |
| Q4 | Same annual allowance for everyone | Approved; the value 30 is an assumption (C-7) |
| Q5 | Holiday region from team | Approved; multi-team conflict (C-3) |
| Q6 | Two-step leave approval | Approved principle; approvers and order **unresolved** (C-4) |
| Q7 | Super Admin approves leave of managers, HR, admins and super admins | Approved principle; own-leave rule **unresolved** (C-5) |
| Q8 | Leave counted in calendar days | Approved |
| Q10, Q11 | CPL = medical leave, deducted from annual leave | Approved; label is an assumption (C-9) |
| Q12 | Requests over the balance are blocked | Approved |
| Q13 | Proration for joiners | Approved; method unresolved (C-10) |
| Q14 | No carry-forward | Approved; leave year is an assumption (C-11) |
| Q15 | Cancelling approved leave needs Admin or Super Admin | Approved; flow and balance restore are assumptions (C-12) |
| Q16 | Past-dated requests allowed | Approved |
| Q18 | Approved leave appears on the duty roster | Approved; overwrite rule (C-14) |
| Q19 | Approved leave affects rotation | Approved; "Leads off" and manual assignment (C-15) |
| Q24, Q26 | Open leads and completed meetings | Approved, already built |
| Q25 | Count assignments by original assignment date | Approved (C-18 confirm) |
| Q27 | No manual call entry | Approved; calls stay "not available" (C-19 for recordings as calls) |
| Q30, Q35 | Receipt gaps allowed; overpayments blocked | Approved, already built |
| Q31 | Reversals approved by Admin and Super Admin only | Approved |
| Q33 | Add "Pay order" payment method; proof attachments | Approved method; attachments in scope after V1 (C-23; formerly CR-4) |
| Q36 | Anyone can own a proposal; only Super Admin edits | Approved; pre-print correction (C-25) |
| Q37–Q41 | Rounding to last installment, 0% default discount, warn on mismatch, agent cap 5%, manager cap 5% | Approved (Q37–Q40 already built) |
| Q42 | Default down payment 25% | Approved; installment count 36 is an assumption (C-26) |
| Q43 | Installment due dates mandatory, 10th of each month | Approved; first month (C-27) |
| Q44 | Price per sq ft by floor | Approved values; project, override rule and ROI **unresolved** (C-28) |
| Q45 | Only Admin and Super Admin assign tasks, to all users | Approved; self-tasks and assignable roles (C-29) |
| Q47 | Proposals reflect unit price changes | Approved; print copy (C-31) |
| Q48 | Only available units in proposals | Approved |
| Q50, Q51 | 12-month sign-in log retention with deletion; sign-ins ≠ attendance | Approved, **subject to signature** |
| Q52 | Recordings playable by Manager, Admin and Super Admin only | Approved (C-32 confirm) |
| Q53 | Recordings kept for life; Super Admin deletes | Approved; erase vs hide (C-33) |

### B. Clear requirements that add scope or cost (see `CHANGE_REQUESTS.md`)

Revised 2 Nov 2026.

| CR | Requirement | Refs | Status |
|---|---|---|---|
| CR-1 | Attendance module (check-in/out, late, absences, hours, breaks; HR and Super Admin manage) | Q20–Q22 | **Commercial decision:** the quotation lists "Attendance"; the depth requested exceeds a Performance line |
| CR-2 | Floor map with the unit marked on printed proposals | Q49 | Change request |
| CR-3 | Refund after a variable deduction on cancelled bookings | Q32 | Change request |

**Reclassified as A (in scope):**
- **Payment proof attachments (Q33):** FR-200 / 201 require attachments in the quoted Finance module, and Q-F9 was open, not excluded.
- **Lead shift on deactivation (Q3):** quoted *Lead assignment* plus FR-030 reassignment.
- **Team weekends (Q9):** quoted *Duty roster*.

All three are scheduled after Version 1.

### C. Ambiguous; client clarification required

| Ref | Topic | ID |
|---|---|---|
| Q6, Q7 | Leave approvers, order, Super Admin's own leave | C-4, C-5 |
| Q17 | Leave spanning two years | C-13 |
| Q21 | Attendance capture rules | C-16 |
| Q23 | Critical rule (agent vs lead, thresholds) | C-17 |
| Q28 | Pipeline pressure formula | C-20 |
| Q29 | Receipt number format | C-21 |
| Q32 | Refund deduction and approval | C-22 |
| Q33 | Methods vs proof | C-23 |
| Q34 | PDP and CDP | C-24 |
| Q44 | Price per sq ft scope and ROI | C-28 |
| Q46 | Task statuses vs types | C-30 |
| Others | Partial details | C-1–C-3, C-6–C-12, C-14, C-15, C-18, C-19, C-25–C-27, C-29, C-31–C-33 |

### D. Existing requirements the questionnaire did not address

All unchanged and still open. Full list in `REMAINING_CLIENT_CLARIFICATIONS.md` §D.
- **Dashboard:** FR-014 aging matrix (M-Q1–M-Q5); D1 and D2 definitions.
- **Notifications:** N2–N6.
- **Bookings:** Q-B1 SPU and 50% shares, Q-B2 holds and auto-release, Q-B3 stage gates, Q-B4 Sold timing, Q-B5 receipt and sales-order templates.
- **Finance:** FR-200 / 201 / 205 income, expenses and income-vs-expense (Q-F4, Q-F15, Q-F16); Q-F8 itemised visibility; Q-F13 backdating.
- **Leads:** FR-032 shared-phone merge (6 questions); FR-043 / FR-075 CSV imports (Q-P5); Q-L7 lead deletion.
- **Security and retention:** document retention and deletion; Q-R5 2FA; C3 CDN.
- **Other:** Q-T2 email; Q12 department lists; TQ2 / TQ4 / TQ5 / TQ7 / TQ8 team rules; Q-P1 meaning of "completion of V1"; Q-P6 / Q-T3 hosting ownership and maintenance.

---

## 2. Contradictions and technical consequences

| Topic | Answer(s) | Consequence / contradiction | Handling |
|---|---|---|---|
| **Two-step leave approval** | Q6 "2 step" | Steps and order unstated. Teams can have no manager (`teams.manager_id` is nullable), so a step could have nobody to act. | Model approvals as ordered steps (`leave_approvals` rows), so the order is data, not code. Build after C-4. Without a manager, the default is for HR to take step 1, pending C-4. |
| **Super Admin leave approval** | Q7 "super admin" | A Super Admin can't approve their own request without a self-approval exception. Unclear whether Q7 replaces both steps or only one. | After C-5. Until then, no self-approval; with several Super Admins, another one approves. |
| **Team-specific weekends** | Q9 + Q8 | Leave uses calendar days, so weekends never change leave; they only matter for the roster and attendance. People can be in several teams. | Nothing for leave. Roster weekends are in scope after V1 (formerly CR-6); attendance use is CR-1 (C-3, C-8). |
| **Employees without logins** | Q1 | `employee_profiles.user_id` is NOT NULL and every HR screen joins `users`. Non-login staff can't submit leave, appear on the roster (keyed by `user_id`), or take part in rotation. | Relax `user_id` to nullable and add `full_name` / `email` on the profile (additive). Keep the existing rows linked. Roster and attendance for non-login staff wait for C-6 / CR-1. |
| **Manual deactivation and lead shift** | Q2, Q3 | Today nothing changes `users.status`. An inactive owner keeps their leads; rotation already skips inactive users. Sign-in already refuses inactive accounts (`login.ts`), and session lookup only loads active users (`session-store.ts`). Deactivation therefore ends access with no auth change. | Account screen (A); deactivation sets `users.status`. Lead shift is in scope after V1 (C-2). |
| **Calendar-day leave across two years** | Q8, Q17 | Q17 reads two ways (split per year, or all in the past year). Q12 blocks over-balance requests, so the reading changes whether some requests are accepted. | C-13. Day counting is built per date so either rule is a small switch; it's not shipped until answered. |
| **Approved leave and rotation** | Q19, Q18 | Rotation ignores the roster today. "Leads off" (TQ3) is still open. Manual assignment to someone on leave isn't addressed. | Rotation excludes agents with approved leave covering *today* (Asia/Karachi). "Leads off" and manual assignment wait for C-15. |
| **Attendance vs sign-in history** | Q20–Q22, Q51 | Consistent: sign-ins stay authentication only. The attendance being asked for is a new module. | No change to sign-in history. Attendance is CR-1. |
| **Critical agent definition** | Q23 | Describes leads, not agents; no thresholds. | Unresolved (C-17). The Performance "Critical" filter stays hidden. |
| **Pipeline pressure** | Q28 | Inputs only (meetings, financial commitment); "financial commitment" could mean tokens received, booking value or payments. | Unresolved (C-20). Stays "not available". |
| **Call metrics with no manual entry** | Q27 | Calls, minutes, quality and meaningful % have no data, and "calls" targets (FR-110) can never show progress. FR-152 call quality could use recording durations. | No change now. C-19 asks whether uploaded recordings count as calls. If yes: count and duration per agent from `files` (kind `recording`), a small change. |
| **Receipt numbering** | Q29, Q30 | The example mixes project and floor codes, and its "SS" doesn't match Q44's "SF". A per-project or per-floor counter needs a sequence per series, and existing receipts already carry integer numbers. | Unresolved (C-21). When answered: add a `receipt_code` text column plus a counter table per series (additive). Existing receipts keep their numbers and display unchanged. |
| **PDP and CDP** | Q34 | Undefined. Possibly payment types; collection stages unknown. | Unresolved (C-24). The payment-type enum can be extended additively. |
| **Refund deductions and approvals** | Q32 | Contradicts the current rule that a booking with payments can't be cancelled. Payments are never deleted (FR-206), so a refund needs new ledger entry kinds. | CR-3, after C-22. The current block stays until then. |
| **Proposal permissions and ownership** | Q36, Q40, Q41 | If only Super Admin can edit, agents can't fix a typo, and Admins lose editing they have today. Discount caps only matter at creation. | Creation stays open to all task users; editing a saved proposal is limited to Super Admin. Pre-print correction waits for C-25. |
| **Proposal pricing updates** | Q47 vs C12 snapshot | Showing the current price contradicts the saved snapshot. A printed proposal can later differ from the screen. Manually edited schedule rows may stop adding up (Q39 allows that with a warning). | The stored snapshot stays (records preserved). Display, print and totals use the unit's current price; a "Price changed since saved (was …)" note shows when they differ. Whether a printed copy is kept waits for C-31. |
| **Mandatory installment due dates** | Q43 | Schedule rows have no date column. Existing proposals have no dates. The first month is unstated. | Add a nullable `due_on` to `task_installment_rows` (additive), required on save for new and edited proposals. Existing proposals show "—" until edited. The generation rule waits for C-27. |
| **Task assignment and statuses** | Q45, Q46 | Q45 removes manager and agent assignment. Q46's list replaces statuses with activity types, which would break overdue (FR-092), To-dos and reports. | Q45 after C-29. Q46 is not built until C-30; statuses stay unchanged. |
| **Recording permissions and lifetime retention** | Q52, Q53 | Agents lose playback of recordings they uploaded. Deletion is permanent if files are erased. Retention "lifetime" means storage grows indefinitely (backup and disk sizing). | Q52 as written (C-32 confirm): agents keep upload and see the list, but can't play or download. Q53: Super Admin delete, audited; erase vs hide per C-33. Storage growth goes in the deployment notes. |
| **Attendance and floor-map scope** | Q20–Q22, Q49 | Both beyond the quoted feature list. | CR-1 and CR-2. Not built without a separate quotation. |

---

## 3. Work packages (category A)

Each package lists modules, database, API, UI, permissions, migration, tests and dependencies. "Blocked by" items are not started until answered.

### WP-0 Configuration-only changes (no code)
- **Items:**
  - manager discount cap = 5 (Q41);
  - default down payment = 25 (Q42);
  - add payment method "Pay order" (Q33);
  - turn on automatic sign-in log deletion after one dry run (Q50).
- **How:** through the existing settings screens (Tasks settings, Finance settings, Security settings) by an Admin or Super Admin in each environment. Each change is audited (`app.setting`).
- **Database:** settings and lookup rows only, written through the app. No migration.
- **Dependencies:**
  - signature S-1, required for Q50 and recommended for all;
  - Q50 also needs the production scheduler (hosting).
- **Tests:** existing settings tests already cover these paths. Re-run the proposal and finance suites after changing values in the test fixture.
- **Effort:** under 0.5 day.

### WP-1 Permission changes (Q31, Q52, Q45, Q36, Q48)

**Modules affected:**
- Finance policy (reversal approval);
- Recordings (`openLeadFile` / recording route, panel);
- Tasks policy (`canAssignTo`, proposal edit);
- Proposal unit picker.

**Database:** none.

**API changes:**
- `POST /api/v1/finance/reversal-requests/:id/decision`: Manager now gets 403.
- `GET /api/v1/recordings/:id`: agents get 403. The download link follows the same rule.
- Task create / update: assignment limited to Admin and Super Admin (C-29 for self-tasks).
- Proposal update: Super Admin only (C-25).
- Proposal unit picker: Available units only.

**UI changes:**
- Approve buttons hidden for managers.
- Recordings panel for agents shows the list with "Playback is limited to managers and admins" instead of the player.
- Assignee picker limited.
- Edit buttons hidden on proposals for non-Super Admins.
- Unit picker filtered.

**Permission matrix:** update `USER_ROLES_AND_PERMISSIONS.md` and the module plans.

**Migration:** none. Existing pending reversal requests addressed to managers remain pending, and Admins can approve them.

**Tests:**
- Unit: policy tables per role.
- Integration:
  - manager approval refused, admin allowed;
  - agent recording 403, manager 200;
  - manager assigning to a team member refused (per C-29);
  - admin editing a proposal refused;
  - reserved unit refused.
- Playwright: update `files.spec.ts` (agent playback becomes 403, upload still works) and the auth role matrix.

**Dependencies:**
- S-1;
- C-32 (confirm);
- C-25 and C-29 for the exact proposal and task rules. Q31, Q52 and Q48 can go first.

**Effort:** 1 day.

### WP-2 Accounts and employee records (Q1, Q2, Q3 deactivation, Q5)

**Modules affected:** users / auth (account admin only), HR employees, Teams, Holidays, My Workplace.

**Database (additive):**
- `employee_profiles.user_id` DROP NOT NULL, keeping the unique index on non-null values;
- new nullable columns `full_name` and `email` on `employee_profiles`, with a check that either `user_id` or `full_name` is set;
- `teams.region` (nullable text);
- `users.deactivated_at` and `deactivated_by_id` (nullable) for the audit trail.

**API changes:**
- `GET/POST /api/v1/users` (Admin and Super Admin): list and create with role and initial password. The password is hashed with the existing `hashPassword`.
- `PATCH /api/v1/users/:id`: role, name, reset password, deactivate, reactivate. Deactivation sets `users.status = inactive`; existing sign-in and session checks then refuse the user, with no change to auth code.
- Employees API accepts profiles without a user.

**UI changes:**
- Settings → Users screen.
- HR Employees "Add employee (no CRM login)", plus "Link to CRM account".
- Team form: region field.
- My Workplace: regional holidays filtered by the user's team region(s).

**Permissions:**
- Admin and Super Admin manage accounts. C-1 decides whether an Admin may touch Super Admin accounts; the default is no.
- A user can't deactivate themselves or the last active Super Admin.

**Migration:**
- Existing profiles keep their `user_id`.
- No backfill, and existing users are unchanged.

**Tests:**
- Integration:
  - create a user, then sign in works (through the existing login service);
  - deactivate, then the open session stops working and sign-in is refused;
  - an Admin can't deactivate a Super Admin (C-1);
  - the last Super Admin is protected;
  - a profile without a user is valid;
  - region filtering (single team; multi-team per C-3).
- Playwright: Admin creates an agent, the agent signs in, Admin deactivates, the agent is signed out.

**Dependencies:**
- C-1 and C-3;
- C-2 for the lead shift (in scope, after V1).

**Effort:** 2.5–3 days.

### WP-3 Leave requests, approvals, balances, My Leaves (Q4, Q6–Q8, Q10–Q17)

**Modules affected:** new `leave` module; HR, My Workplace, Teams (manager), notifications.

**Database (additive):**
- **`leave_requests`:**
  - columns: employee profile id, type (`annual`, `medical`), start date, end date, days, reason, status (`pending`, `approved`, `rejected`, `cancel_requested`, `cancelled`), created by (self, or HR on behalf per C-6), and timestamps;
  - check constraint `start <= end`.
- **`leave_approvals`:** request id, step number, approver role or user, decision, comment, decided at.
- **Settings:** `leave.annual_days` (30 per C-7) and `leave.year_start` (January per C-11).
- **Balances are derived, not stored:**
  - prorated allowance (C-10) minus approved days in the leave year;
  - cross-year split per C-13.

**API changes:**
- `POST /api/v1/leave` (submit; blocked when over the balance, Q12).
- `GET /api/v1/leave?mine|team|all`.
- `POST /api/v1/leave/:id/decision` (step-aware).
- `POST /api/v1/leave/:id/cancel-request` and `/cancel-decision` (Admin or Super Admin, Q15).
- `GET /api/v1/leave/balance`.

**UI changes:**
- My Workplace "My leaves" (replacing the pending card): balance, request form, history.
- HR Leave inbox and calendar.
- Manager approvals inbox.
- Employee detail: balance.

**Permissions:**
- Employees: own requests.
- Approvers per C-4 / C-5.
- Cancellation: Admin or Super Admin.
- HR: all (and on-behalf requests for non-login staff per C-6).

**Notifications:** new types (submitted, needs your approval, approved, rejected, cancelled), reusing the existing service.

**Migration:** new tables only.

**Tests:**
- Unit: day counting (calendar days, inclusive; leap years); proration (C-10); cross-year rule (C-13); over-balance block.
- Integration:
  - two-step flow in order (step 2 can't act before step 1);
  - Super Admin path;
  - self-approval refused;
  - cancellation restores the balance (C-12);
  - past-dated allowed;
  - HR on behalf.
- Playwright: agent requests leave, then manager and HR approve, then the balance and My leaves update.

**Dependencies:** **C-4, C-5, C-13 (blocking)**; C-6, C-7, C-9–C-12.

**Effort:** 4–5 days.

### WP-4 Roster and rotation integration (Q18, Q19)

**Modules affected:** Teams (roster), Leads (rotation), Leave.

**Database:** none, or a nullable `roster_entries.leave_request_id` (additive) so entries created from leave can be removed on cancellation without touching manual entries.

**Behaviour:**
- On final approval, write "On leave" roster entries for each day and each team of the employee. Whether to overwrite existing entries, and which teams, follows C-14.
- On cancellation, remove only entries linked to that request.
- Rotation excludes agents with approved leave covering today; "Leads off" per C-15.

**API / UI:** roster shows leave-sourced entries as read-only ("From approved leave").

**Tests:**
- approval fills the roster, and cancellation clears only linked rows;
- rotation skips an agent on leave and resumes after it;
- when every agent is on leave, rotation returns no owner (existing "unassigned" path).

**Dependencies:** WP-3; C-14, C-15.

**Effort:** 1 day.

### WP-5 Performance definitions (Q24–Q27)
- **Change:** count assignments by original assignment date (Q25, C-18), using the first assignment activity per lead and falling back to creation date for older leads.
- Q24, Q26 and Q27 need no change.
- If C-19 says recordings count as calls: calls = recordings uploaded per agent per range, minutes = sum of durations (recordings without a duration counted but unmeasured).
- **Database:** none.
- **Tests:** a lead created unassigned and assigned later counts on the assignment date; a reassigned lead counts for the original agent and date (per C-18).
- **Effort:** 0.5 day (plus 0.5 day if C-19 is yes).
- **Blocked items:** Critical (C-17) and Pipeline pressure (C-20) stay "not available".

### WP-6 Finance rules (Q29, Q31 → WP-1, Q33, Q34)

**Receipt format (after C-21):**
- `booking_payments.receipt_code` (nullable text, unique), plus a `receipt_series` table: series key → next number. Codes are allocated in the same transaction as the payment.
- Existing receipts keep `receipt_no` and their current display; no rewrite.
- Print and lists show the code when present.

**Payment types (after C-24):** extend the `booking_payment_type` enum with the PDP / CDP values (additive `ALTER TYPE … ADD VALUE`). Allowed stages per type as answered.

**Pay order:** WP-0 (lookup row).

**Tests:**
- concurrent receipt allocation gives unique codes with no duplicates;
- old receipts unchanged;
- series per project or floor as answered;
- a type refused at a disallowed stage.

**Effort:** 1–1.5 days. **Blocked by C-21 and C-24.**

### WP-7 Proposals (Q36 → WP-1, Q42–Q44, Q47, Q48 → WP-1)

**Due dates (Q43):**
- `task_installment_rows.due_on` (nullable date, additive).
- Generated on the 10th of consecutive months from the start month (C-27); editable; required on save for new and edited proposals.
- Printed in the schedule.

**Floor prices (Q44, after C-28):**
- A `proposal_floor_prices` setting per project and floor, or global (per C-28). It is used as the unit price when a unit has none, or always (per C-28).
- ROI stays "not set" until given.

**Current price (Q47):**
- Totals, schedule amounts and print use the unit's current price.
- The saved snapshot remains in the record; the UI notes "Price changed since saved".
- Whether a printed copy is kept is decided by C-31.

**Tests:**
- 36 installments land on the 10th, crossing a year boundary;
- the remainder goes on the last row (Q37 unchanged);
- current price used after a unit price change, while the old snapshot is still stored;
- floor price applied (C-28);
- printing a proposal without dates is refused, or shows "—" for legacy proposals.

**Effort:** 1.5–2 days. **Blocked:** floor prices (C-28); due-date start (C-27).

### WP-8 Recording deletion by Super Admin (Q53)

**Modules affected:** Recordings, storage, audit, lead timeline.

**Database (additive):** `files.deleted_at` and `deleted_by_id` (nullable). Lists and reads ignore deleted rows.

**Behaviour:**
- Super Admin only.
- Confirmation dialog.
- Audit row `lead.recording_delete`, with name, size and sha256.
- Timeline entry.
- The stored file is removed or kept per C-33. With "erase", the row stays as a tombstone so the audit and timeline remain intact.

**Tests:**
- non-Super Admin gets 403;
- a deleted recording returns 404 to everyone;
- the audit row is written;
- the file is removed or kept per C-33;
- documents are unaffected.

**Effort:** 0.5–1 day.

**Dependency:** C-33.

---

## 4. Order of work

| Phase | Packages | Can start | Effort (dev-days) |
|---|---|---|---|
| 0 | WP-0 settings (except Q50 until S-1) | On Zeploy approval | < 0.5 |
| 1 | WP-1 (Q31, Q52, Q48 first; Q36 and Q45 after C-25 / C-29) | After S-1 and C-32 | 1 |
| 2 | WP-2 accounts and employee records | After C-1 and C-3 | 2.5–3 |
| 3 | WP-8 recording delete; WP-5 performance | After C-33 and C-18 | 1–1.5 |
| 4 | WP-3 leave | After C-4, C-5, C-13 (+ C-6, C-7, C-9–C-12) | 4–5 |
| 5 | WP-4 roster and rotation | After WP-3, C-14, C-15 | 1 |
| 6 | WP-7 proposals | Due dates after C-27; prices after C-28 | 1.5–2 |
| 7 | WP-6 finance | After C-21, C-24 | 1–1.5 |
| | **Total in-scope (category A)** | | **≈ 12–15**, plus 3–4.5 for the three reclassified items = **≈ 15–19.5** |
| — | CR-1 (commercial decision), CR-2, CR-3 | After separate quotation | 12–18 (`CHANGE_REQUESTS.md`) |

**Version 1 delivery (revised 3 Nov 2026).**
- There is no demo environment.
- Version 1 is the CRM **deployed on the client's own server and handed over** for the client's acceptance testing, with 10 Nov 2026 as the target.
- `VERSION_1_EXECUTION_PLAN.md` defines exactly what that includes:
  - E1–E3 plus production preparation P1–P5;
  - E4 / E5 only after the signed approval;
  - everything else in this document after Version 1.
- Leave (phase 4) depends on answers not yet received.

**Every phase ends with:**
- typecheck and lint;
- full Vitest and Playwright on the test database;
- schema drift check;
- production build;
- a `PROJECT_STATUS.md` update.

There is no commit, push or deploy without instruction.

## 5. Preserved behaviour (explicitly unchanged)
- **Authentication:** login, sessions, rate limiting, sign-in history and the trusted-proxy IP. Account creation uses the existing password hashing and session revocation only.
- **Existing records:** all are kept.
  - Proposals keep their stored snapshots.
  - Receipts keep their numbers.
  - Recordings and documents are not touched except by an explicit Super Admin delete (Q53).
- **Finance safeguards:**
  - no hard deletes of payments;
  - overpayment block;
  - the reversal maker-checker rule (approvers change, the requester still can't approve except the Super Admin emergency path).
- **Unchanged until answered:** task statuses, booking stage rules and the booking-cancel block.

## 6. Approval gate
1. **Zeploy Tech:** approve this plan, and decide how to handle CR-1 and how to quote CR-2 and CR-3. What is ready on 10 Nov is defined in `VERSION_1_EXECUTION_PLAN.md`.
2. **Client:**
   - sign the questionnaire (S-1);
   - answer the **blocking** items (C-4, C-5, C-13, C-16, C-17, C-20, C-21, C-22, C-24, C-28, C-30);
   - answer the others when possible.
3. Development starts per phase only after both.
