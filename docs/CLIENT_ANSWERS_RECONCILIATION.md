# Client questionnaire: answer-by-answer reconciliation

Categories revised 2 Nov 2026 after the Version 1 scope recheck (Q3, Q9, Q20–22, Q33).

Source: *MZ MARKETING CRM Questionnaire Answers.docx*, received 2 Nov 2026. Reviewed against the code at commit `f3edf9e`.

**Status of the document.**
- All 53 questions have an answer.
- **Section 9 ("Additional Requirements and Client Approval") is blank.** Representative name, designation, signature and date are all empty.
- Until it is signed, every answer below is treated as **received but not formally approved**. This matters most for Q50: the agreed rule is that automatic deletion of sign-in logs stays off until there is *written* approval.

**Columns.**
- **Response:** copied exactly from the document, including spelling.
- **Clear?**
  - **Yes:** can be built without further input.
  - **Partly:** the main decision is clear, but a detail needed to build it is missing.
  - **No:** the answer cannot be built without clarification.
- **Category:** the classification in `POST_QUESTIONNAIRE_IMPLEMENTATION_PLAN.md` §1.
  - **A:** clear and in the quotation.
  - **B:** clear but additional scope.
  - **C:** needs client clarification.

Nothing here is reinterpreted. Where an answer can be read more than one way, all readings are listed and the question goes to `REMAINING_CLIENT_CLARIFICATIONS.md`.

---

## 1. HR and employee management

| Q | Exact client response | Existing CRM behaviour | Required change | Clear? | Category | Dependencies / modules |
|---|---|---|---|---|---|---|
| 1 | "HR also maintain records for employees who do not need CRM login accounts" | `employee_profiles.user_id` is **required** (one profile per CRM user). Staff without a login cannot be recorded. | Employee records that exist without a user account; optionally linked to a CRM user later. | Yes | A | HR (Employees), schema. Affects leave (Q6+) and attendance (Q20+): non-login staff cannot submit leave themselves. **Open:** who submits their leave (§C-6). |
| 2 | "Admin and super admin" | No account-management screen. Accounts are created only by the seed script; HR edits profile fields only. | User-account screen for Admin and Super Admin: create, set role, reset password, deactivate and reactivate. | Yes | A | Auth / users, HR, audit. Must not change sign-in behaviour. **Open:** can an Admin create or deactivate a Super Admin (§C-1)? |
| 3 | "Manual disable with lead shift option" | Users have `status` active / inactive, but no screen changes it. Leads can be reassigned one at a time (FR-030). There is no "employee inactive" flag separate from the account. | Deactivation stays manual. While deactivating, the admin may move the person's open leads to another agent in one step. | Partly | A (deactivation and lead shift; reclassified 2 Nov) | Users, Leads (assignment, notifications, audit), Teams, rotation. **Open:** which leads move (open only, or all) and whether follow-ups, tasks and meetings move with them (§C-2). |
| 4 | "should be same for all" | No leave module. The proposed default was 30 days. | One company-wide annual allowance. The value is not restated; 30 days is the **proposed default and unconfirmed** (§C-7). | Partly | A | Leave. |
| 5 | "based on team." | Holidays have a `region` text; employees and teams have no region; My Workplace shows every regional holiday with a label. | Each **team** gets a region; an employee sees company holidays plus their team's regional holidays. | Partly | A | Teams, Holidays, My Workplace. **Conflict:** a user may belong to several teams today (T-A2), so they could have several regions. See §C-3. |

## 2. Leave requests, approvals and balances

| Q | Exact client response | Existing CRM behaviour | Required change | Clear? | Category | Dependencies / modules |
|---|---|---|---|---|---|---|
| 6 | "2 step" | No leave module. | Two approvals per request. The **order and the approvers are not stated** (the question's example was "Team Manager, HR, or a two-step approval involving both"). | Partly | A | Leave, Teams (manager), HR, notifications. §C-4. |
| 7 | "super admin" | — | Leave of Managers, HR, Admins and Super Admins is approved by a Super Admin. **Not stated:** whether this is one step or two, and who approves a Super Admin's own leave. | Partly | A | Leave. §C-5. |
| 8 | "Calendar days" | — | Leave days = calendar days, inclusive of weekends and public holidays. | Yes | A | Leave. |
| 9 | "Variable according to team" | No weekend concept anywhere. | Each team defines its weekend days. Under Q8, weekends **do not reduce leave**, so this affects only the roster and attendance. | Partly | A (roster; reclassified 2 Nov) | Teams, Roster, Attendance. §C-8. |
| 10 | "Medical leaves" | — | The leave type named "CPL" means medical leave. **Not stated:** whether it should be labelled "Medical" or "CPL", or whether it needs a certificate. | Partly | A | Leave. §C-9. |
| 11 | "annual leaves" | — | CPL / medical leave is deducted from the annual allowance (no separate balance). | Yes | A | Leave. |
| 12 | "No" | — | A request that exceeds the remaining balance is **blocked** at submission. | Yes | A | Leave. |
| 13 | "Yes" | — | Prorate the allowance for joiners during the year. **Not stated:** the method (by month or by day) and rounding. | Partly | A | Leave, Employees (joining date). §C-10. |
| 14 | "No" | — | No carry-forward; balances reset each year. **Not stated:** calendar year (Jan–Dec) or another leave year. | Partly | A | Leave. §C-11. |
| 15 | "admin n super admin" | — | Cancelling *approved* leave requires approval by an Admin or Super Admin. **Not stated:** whether the employee requests the cancellation, and that the balance is restored. | Partly | A | Leave, Roster (remove "On leave"). §C-12. |
| 16 | "Yes" | — | Past-dated requests are allowed. No limit was given. | Yes | A | Leave, Roster (past days are locked after 11:00 today, TQ4). |
| 17 | " the past year, the year in which the month lies" | — | Two readings: **(a)** each day counts against the year it falls in (split); **(b)** the whole request counts against the earlier ("past") year. | **No** | C | Leave. §C-13. |
| 18 | "Yes" | Roster statuses include `on_leave`; the roster is entered manually per team and day. | Approved leave writes "On leave" into the roster for each day. Cancelling it removes those entries. | Partly | A | Roster, Leave. **Open:** what happens if the person is in several teams' rosters, or the day is locked (§C-14). |
| 19 | "Yes" | Rotation picks active agents in active teams. **Roster and leave are ignored** (TQ3 open). | Agents on approved leave are skipped by automatic rotation on those days. | Partly | A | Leads (rotation), Leave, Roster. **Open:** should the roster's "Leads off" also skip rotation (TQ3), and should manual assignment to someone on leave be allowed (§C-15)? |

## 3. Attendance

| Q | Exact client response | Existing CRM behaviour | Required change | Clear? | Category | Dependencies / modules |
|---|---|---|---|---|---|---|
| 20 | "Yes" | Attendance shown as "not available"; sign-in history is authentication only (decided 30 Oct, confirmed by Q51). | A separate attendance feature. | Yes | **B / commercial decision** (quote lists "Attendance") | New module. `CHANGE_REQUESTS.md` CR-1. |
| 21 | "Yes, all above" | — | Record check-in, check-out, late arrivals, absences, working hours and breaks. **Not stated:** how times are captured (employee clicks in the CRM, HR enters them, device import), shift and office times, the late threshold, break rules. | **No** (for building) | B + C | Attendance, Teams (weekends Q9), Holidays, Leave. §C-16. |
| 22 | " HR and super admin" | — | HR and Super Admin view, manage and correct attendance. Admins, Managers and employees are **not** included. | Yes | B | Attendance permissions. **Open:** can employees see their own attendance in My Workplace (§C-16)? |

## 4. Performance and reporting

| Q | Exact client response | Existing CRM behaviour | Required change | Clear? | Category | Dependencies / modules |
|---|---|---|---|---|---|---|
| 23 | "new lead, or meeting commitment leads" | The Critical agent flag (FR-153) is not built; there is no rule (Q-L8). | The answer describes **leads** (new leads; leads with a meeting commitment), but FR-153 is an **agent** flag. Thresholds (how many, how old) are missing. | **No** | C | Performance, Leads. §C-17. |
| 24 | "Yes" | Open leads = leads currently in an open stage (implemented, PQ2). | None. Confirms current behaviour. | Yes | A | — |
| 25 | "original" | Performance counts assignments by lead **creation** date (PQ3 default). | Count by **original assignment date**. That equals creation date for most leads, but not for leads created unassigned and assigned later. | Partly | A | Performance, Leads (assignment activity). §C-18 (one-line confirm). |
| 26 | "Yes" | Performance counts completed meetings only (PQ4 default). | None. Confirms. | Yes | A | — |
| 27 | "No" | Call metrics show "not available" (no call data source). | Call outcomes and counts will **not** be entered manually. Calls, call minutes, call quality and Meaningful call % stay "not available" unless uploaded recordings count as calls (open since round 1). | Partly | A (no change) | Performance, Targets ("calls" targets have no actuals), Daily reports. §C-19. |
| 28 | "meeting counts and financial commitment" | Pipeline pressure is not built (PQ6). | Inputs named (meetings, financial commitment); no formula, scale or period. | **No** | C | Performance. §C-20. |

## 5. Finance and payment policies

| Q | Exact client response | Existing CRM behaviour | Required change | Clear? | Category | Dependencies / modules |
|---|---|---|---|---|---|---|
| 29 | "BH-GF/FF/SS-123" | Receipt numbers come from one database sequence (integer, unique, never reused), displayed with a configurable prefix (`finance_settings.receipt_prefix`). | A formatted receipt code. Not stated: what "BH" is (project code?), whether "GF/FF/SS" are floor codes (Q44 uses **SF** for second floor), whether numbering restarts per project or floor, and the format for other projects. | **No** | C | Finance, Inventory (floor), Projects (code). §C-21. |
| 30 | "YES" | Gaps are allowed (sequence). | None. Confirms. | Yes | A | — |
| 31 | "Admin and super admin" | Accountant requests a reversal; **Manager (own team's bookings)**, Admin or Super Admin approves; Super Admin has an audited emergency exception. | Remove Manager approval. Admin or Super Admin approve. Super Admin keeps the exception (the question offered it and the answer didn't remove it). | Yes | A | Finance (reversal approval), notifications. |
| 32 | "refund after specified deduction( variable)" | A booking with net payments > 0 **cannot be cancelled** (Q-F10 default). No refund or deduction entries exist. | Cancellation after payment leads to a refund of the paid amount minus a deduction chosen per case. Not stated: who sets and approves the deduction, and whether it is recorded as income. | Partly | **B** + C | Finance, Bookings (cancel), Inventory (unit release). §C-22. The quotation excludes financial workflows not listed (refunds aren't). |
| 33 | "online receipt, cash images, cheque and pay order." | Seeded methods: Cash, Bank Transfer, Cheque, Online Payment (configurable lookup). Payments have no attachments (Q-F9). | **Pay order** is a new method. "Online receipt" and "cash images" read as **proof attachments** (receipt or photo), not methods. | Partly | A (methods and attachments; attachments reclassified 2 Nov) + C | Finance, storage. §C-23. |
| 34 | "intial payment which can be token, pdp and cdp" | Payments are accepted from Token pending through Confirmed, typed Token / Down payment / Installment / Other. | "PDP" and "CDP" are not defined anywhere in the project. The stages at which collection is allowed are not stated in stage terms. | **No** | C | Finance, Bookings. §C-24. |
| 35 | "Yes" | Overpayments are blocked. | None. Confirms. | Yes | A | — |

## 6. Tasks and proposal policies

| Q | Exact client response | Existing CRM behaviour | Required change | Clear? | Category | Dependencies / modules |
|---|---|---|---|---|---|---|
| 36 | "everyone can own proposal, editing can be done by super admin" | Agents, Managers and Admins create and edit proposals in their scope (own / team / all). | Any user may create (own) a proposal. **Only Super Admin can edit a saved proposal.** Admins and Managers lose editing. **Not stated:** whether owners can fix their own proposal before printing, or whether it locks on first save. | Partly | A | Tasks (proposal policy). §C-25. |
| 37 | "Yes" | Rounding remainder goes on the last installment (C4). | None. Confirms. | Yes | A | — |
| 38 | "Yes" | Default discount 0% (C5). | None. Confirms. | Yes | A | — |
| 39 | "with warning" | Mismatched rows save with a warning (C6). | None. Confirms. | Yes | A | — |
| 40 | "Yes" | Agent cap 5% (seeded). | None. Confirms. | Yes | A | — |
| 41 | "Yes, 5%" | Manager cap blank, so managers fall back to the agent cap (5%). | Set the manager cap to 5% explicitly. | Yes | A | Settings value only. |
| 42 | "default dp 25%" | Down payment 30%, installments 36. | Down payment default → **25%**. The installment count was **not answered** (36 stays until confirmed). | Partly | A | Settings value. §C-26. |
| 43 | "No, it should be 10th of every month" | Schedule rows have **no due-date field** (label, description, progress, amount only). | Every installment row gets a mandatory due date on the 10th of a month. **Not stated:** the first installment's month (proposal date, booking date, month after down payment) and the down payment's date. | Partly | A | Tasks (schedule rows, print). §C-27. |
| 44 | "GF=10,824 FF=9593 SF= 8624" | The default price per sq ft is one global setting (not set). Units have their own `base_price`. | Prices per sq ft by floor: Ground 10,824, First 9,593, Second 8,624. **Not stated:** which project(s), whether they override unit prices or only fill gaps, and the **ROI rate** (not given). | Partly | A | Tasks settings, Inventory (unit floor), Projects. §C-28. |
| 45 | "Admin and super admin to allow task, they can assign to all users" | Agents create tasks for themselves; Managers assign to self or team; Admins assign to anyone. | Only Admin and Super Admin assign tasks, to any user. **Not stated:** whether agents and managers can still create their **own** tasks, and whether HR and Accountants become assignable (today they are not). | Partly | A | Tasks policy. §C-29. |
| 46 | "contacted client, follow up call, call attempt, meeting done, meeting aligned, payments etc" | Task statuses: Open, In progress, Done, Cancelled (FR-090). | The list reads as **activity types**, not workflow statuses; "etc" leaves it open-ended. Replacing statuses would break "overdue" (FR-092) and To-dos. | **No** | C | Tasks, To-dos. §C-30. |
| 47 | "reflect unit changes" | A saved proposal keeps its quoted unit price and ROI (snapshot, C12). | Proposals show the **current** unit price. Consequence: a printed proposal and the system can disagree, and manually edited schedule rows may no longer add up. | Yes (decision) | A | Tasks. Confirm consequences, §C-31. |
| 48 | "available units" | Any unit can be picked; the status is shown (C13). | Only units with status **Available** can be chosen. | Yes | A | Tasks, Inventory. |
| 49 | "all unit details including installment and designated map with unit number marked on it" | Print shows unit details and the installment schedule; no map. | Add a floor map with the unit marked. Needs plan images per project or floor and a unit position on each. | Yes (intent) | **B** | Projects / Inventory (map assets), storage, print. `CHANGE_REQUESTS.md` CR-2. |

## 7. Security and data retention

| Q | Exact client response | Existing CRM behaviour | Required change | Clear? | Category | Dependencies / modules |
|---|---|---|---|---|---|---|
| 50 | "YES" | Sign-in log retention is set to 12 months; **automatic deletion is off**, and the job supports `--dry-run`. | Turn automatic deletion on, after a dry run, **once the document is signed** (written approval). No code change. | Yes, subject to signature | A | Security settings, scheduled job (hosting). |
| 51 | "yes" | Sign-in history is authentication only. | None. Confirms (C1). | Yes | A | — |

## 8. Calling and recording workflow

| Q | Exact client response | Existing CRM behaviour | Required change | Clear? | Category | Dependencies / modules |
|---|---|---|---|---|---|---|
| 52 | "Manager, admin , super admin" | Anyone who can view the lead can play its recordings: the **owner agent**, their team manager, Admin, Super Admin. | Remove playback for **agents**, including the agent who uploaded the call. Agents can still upload. | Yes (as written) | A | Recordings (open route, panel), lead detail. Confirm intent, §C-32. |
| 53 | " it should be retained lifetime, and deleted by super admin" | Recordings are kept indefinitely; there is **no delete** (deletion waited for client rules). | Keep indefinitely; add **Super Admin delete** of individual recordings, audited. | Yes | A | Recordings, storage, audit. **Open:** permanent removal of the file vs. hidden with file kept (§C-33). Documents were not covered (D list). |

## 9. Additional requirements and approval

| Item | Response | Consequence |
|---|---|---|
| Additional policies | Blank | None added. |
| Representative name, designation, signature, date | **Blank** | Answers are unapproved. Needed before: enabling sign-in log deletion (Q50), any permission removal (Q31, Q36, Q45, Q52), and quoting change requests. |
