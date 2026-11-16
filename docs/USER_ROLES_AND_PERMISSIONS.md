# User Roles and Permissions

## 1. Observed in the reference CRM

| Evidence | Where | Label |
|---|---|---|
| Role badge "Sales Agent" on the inspection account | Dashboard header | OBSERVED |
| "HOD Sales / All teams" selector | Dashboard → executive essentials | OBSERVED (suggests an HOD Sales / manager role) |
| "Managers and admins can approve team lost requests from Approvals" | Leads → Lost | OBSERVED |
| "Reviews on leads assigned to you … Manager reviews" | Leads → Reviews | OBSERVED |
| Daily report: "Managers enter … Admins can review … Admins see all teams; managers see their own" | Teams → Daily Report | OBSERVED |
| "Agents: discount editable up to 5% (app settings)" | Tasks → proposal | OBSERVED |
| "Access denied" for Teams list, Project detail, HR Employees, HR Holidays | Respective pages | OBSERVED |
| Add lead page stuck on "Checking access…" | Leads → new | UNKNOWN (permission or slow load) |
| Lead lists scoped to "your lead scope" / "My leads" | Dashboard, Reviews | OBSERVED (agents see their own leads) |
| Targets "for your user" | Targets | OBSERVED |
| Performance "for your scope" | Performance | OBSERVED |

### Roles evidenced

- **Sales Agent:** OBSERVED.
- **Manager / HOD Sales:** INFERRED from the text above.
- **Admin:** INFERRED from the text above.
- **HR, Finance, Super-admin:** UNKNOWN.

### Data scope

- **INFERRED:** agents see their own leads, managers see their team's, admins see everything. Every list is also limited to the selected project.

---

## 2. Proposed roles for the new CRM (PROPOSED, needs confirmation)

| Role | Description |
|---|---|
| **Super Admin** | Owner / IT. Full access, settings, users, roles, integrations. |
| **Admin** | Operations head. All modules and all teams; cannot change system integrations. |
| **Sales Manager (HOD)** | Manages one or more teams: assigns and reassigns leads, approves lost requests, writes reviews, sets targets, daily reports, roster. |
| **Sales Agent** | Works own leads, follow-ups, meetings, tasks, bookings and proposals. |
| **HR** | Employees, holidays, leave approvals. |
| **Accountant** | Accounts & Finance module; records payments; views bookings read-only. |

Users can hold **one role**. PROPOSED: permissions are role-based, with optional per-user overrides **not** in V1.

### Permission matrix (PROPOSED)

> **13 Nov 2026: Manager merged into Admin.** The owner treats Manager and Admin as one role. Every Sales Manager became an Admin with full Admin access (migration 0034), and the Manager role is no longer offered when creating or changing accounts. The Manager column below is kept for history only. Admins can lead teams ("Team admin") and receive their team's lost requests.

Legend: **F** full · **T** own team · **O** own records · **R** read-only · **—** none

| Module / action | Super Admin | Admin | Manager | Agent | HR | Accountant |
|---|---|---|---|---|---|---|
| Dashboard | F | F | T | O | — | R (finance KPIs) |
| Leads: view | F | F | T | O | — | — |
| Leads: create | F | F | T | O | — | — |
| Leads: verify an agent's new lead (approve / reject with reason; since 13 Nov 2026) | F | F | — | — | — | — |
| Leads: work on own lead before it is verified | F | F | T | — (view only; a rejected lead's details can be corrected and resubmitted) | — | — |
| Leads: add notes and reviews (agents on their own leads since 16 Nov 2026) | F | F | T | O | — | — |
| Leads: reassign | F | F | T | — | — | — |
| Leads: mark lost | F | F | T (approve) | O (request) | — | — |
| Leads: delete | F | — | — | — | — | — |
| Leads: merge duplicates | F | F | T | — | — | — |
| Clients | F | F | T | O | — | R |
| Projects: view | F | F | R | R | — | R |
| Projects: create / edit (Super Admin only since 15 Nov 2026) | F | — | — | — | — | — |
| Inventory: view | F | F | R | R | — | R |
| Inventory: edit / import (Super Admin only since 15 Nov 2026) | F | — | — | — | — | — |
| Bookings: create | F | F | T | O | — | — |
| Bookings: change stage | F | F | T | O (up to Sales order) | — | R |
| Bookings: confirm / cancel | F | F | T | — | — | — |
| Tasks | F | F | T | O | O (assigned to them; no create) | O (assigned to them; no create) |
| Tasks: assign to someone else (Q45, since 10 Nov 2026) | F | F | — | — (own tasks only) | — | — |
| Proposal: edit once saved (Q36, since 10 Nov 2026; `tasks/policy.ts` `canEditSavedProposal`) | F | — | — | — | — | — |
| Proposal discount | any | any | ≤ manager cap | ≤ agent cap (5%) | — | — |
| Meetings | F | F | T | O | — | — |
| Targets: set | F | F | T | — | — | — |
| Targets: view | F | F | T | O | — | — |
| Teams / daily report / roster | F | F | T | R (own roster) | R | — |
| HR employees / holidays | F | F | R | — | F | — |
| HR records without a CRM login (Q1) | F | F | R | — | F | — |
| Leave: request | ✓ (approved at once) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Leave: approve agents' and accountants' leave ("staff" path, two configured steps) | F | F | T | — | F | — |
| Leave: approve HR staff's and Admins' leave ("senior" path) | F | — | — | — | — | — |
| Leave: record for someone else (phoned in sick, staff without a login; 15 Nov 2026) | F (approved at once) | F (approved at once for agents, accountants and staff without a login) | — | — | F (waits for approval) | — |
| Performance | F | F | T | O | — | — |
| Accounts & Finance | F | R | — | — | — | F |
| Payment reversal: decide | F (also their own request) | F (not their own request) | — | — | — | — (requests only) |
| CRM accounts: create, role, password, deactivate, lead shift (Q2, Q3) | F | F, except Super Admin accounts (C-1) | — | — | — | — |
| Settings → Users & access (every account, including Super Admins) | F | — | — | — | — | — |
| Recordings: delete (Q53; hides, file kept) | F | — | — | — | — | — |
| Settings, users, roles | F | users only (not Super Admins) | — | — | — | — |
| City list (FR-042, S-22) | F | F | — | — | — | — |
| Settings → Security (sign-in history and its retention) | F | F | — | — | — | — |
| Audit log (view and CSV download) | F | R | — | — | — | — |
| Lead import batches: submit (Admin and Super Admin only since 13 Nov 2026) | F | F | — | — | — | — |
| Lead import batches: approve / reject | F | — | — | — | — | — |
| Claim an unassigned lead (Leads → Unassigned) | — | — | F | F | — | — |
| Assign an unassigned lead from the Unassigned list (16 Nov 2026) | F | F | — | — | — | — |
| Appoint a team's Team Lead (15 Nov 2026) | F | F | — | — | — | — |
| Team Lead's read-only team view ("My team"; an agent who leads a team) | — | — | — | Team Lead only | — | — |
| Employee work profile (calls, minutes, pipeline, follow-ups, targets, attendance; 15 Nov 2026) and its CSV | F | F | — | — | — | — |
| Coaching notes on a work profile: add (16 Nov 2026; never on yourself) | F | F | — | — | — | — |
| Coaching notes: delete | F (anyone's) | F (own notes only) | — | — | — | — |
| HR CSV downloads (employees, leave, balances, attendance) | F | F | — | — | F | — |
| Assignment & scores (rotation rule, agent score settings) | F | F | — | — | — | — |
| Backups page (read-only; restore only on the server) | F | — | — | — | — | — |

**Changes from the client questionnaire (implemented 3 Nov 2026):** Tasks for HR and Accountants (Q45), HR records without logins (Q1), account management (Q2, Q3) and recording deletion (Q53).

**Applied since (confirmed 10 Nov 2026):** proposal editing limited to the Super Admin (Q36) and task assignment limited to Admins and Super Admins (Q45). Self-tasks stay allowed.

**Not yet applied** (updated 16 Nov 2026): agents can still play recordings on leads they can see (Q52). Manager reversal approval (Q31) no longer matters: nobody holds the Manager role.

### Super Admin only (updated 16 Nov 2026)

Checked in code. Admins cannot do these:
- **Settings → Users & access:** manage every account, including other Super Admins. The last active Super Admin can't be deactivated or demoted. Elsewhere, Admins manage accounts but can't touch a Super Admin account or grant that role.
- **Settings → Backups** (read-only status).
- **Approve or reject lead import batches** (`leads/imports.ts` `canDecideImport`). Admins and Super Admins submit them.
- **Delete call recordings** (`files/lead-files.ts`; the file is hidden, not erased).
- **Approve leave of HR staff and Admins** (the "senior" path, `leave/service.ts`). A Super Admin's own leave is approved on submission, and leave a Super Admin records for anyone is approved at once.
- **Edit a saved proposal** (`tasks/policy.ts` `canEditSavedProposal`).
- **Approve their own payment reversal request** (`finance/commands.ts`). Everyone else needs a second person.
- **Delete anyone's coaching note.** Admins delete only their own.
- **Add or edit projects and inventory** (since 15 Nov 2026). Admins see them read-only.

### Team Lead (15 Nov 2026)

A Team Lead is an agent an Admin or Super Admin appoints for one team (`teams.team_lead_id`). They keep working as an agent. They also get a read-only **My team** page: the team's members, pipeline, performance and roster, and (16 Nov 2026) each agent's win %, follow-up %, agent score, targets met and running targets with progress. Coaching notes and the work profile stay with Admins. They can't reassign leads or change the team.

### Work profiles and coaching notes (16 Nov 2026)

Admins and Super Admins open any employee's work profile (`people/profile.ts`) and can download it as CSV (audited as `people.export`; coaching notes are never in the file, since it may be handed to the employee). They can add private coaching notes. The person a note is about never sees it, even an Admin opening their own profile, and nobody can add notes on themselves.

### Enforcement rules (PROPOSED)

1. Permissions are enforced on the **server** for every request. Hiding UI elements is cosmetic only.
2. **Record scope** is applied in queries: `own` = `ownerId = me`; `team` = owner in the teams I manage; `all` = no filter. The project scope is always applied as well.
3. Approval actions (lost, leave, discount above the cap) create an approval record with the approver and a timestamp.
4. Role changes and permission denials are written to the audit log.

## 3. Questions to confirm

See `ASSUMPTIONS_AND_OPEN_QUESTIONS.md`: Q-R1 to Q-R6.

## Sidebar per role (10 Nov 2026)
The sidebar shows only the modules a role can open. Each item's role list (`src/config/navigation.ts`) matches the page's own check, and `tests/unit/navigation-roles.test.ts` keeps them equal. **No permission changed:** pages and APIs still check access, and an address typed by hand still shows Access denied.
**Updated 16 Nov 2026** (from `src/config/navigation.ts`):
- **Super Admin:** everything except My team. Settings: Assignment & scores and Users & access. The settings tabs also give Security, Cities, Audit log and Backups.
- **Admin:** the same, without Users & access and Backups.
- **Agent:** Dashboard, Leads, New leads, To-dos, Clients, Projects, Inventory, Targets, Bookings, Tasks, Meetings, and under Reports My performance and My workplace. A Team Lead also sees **My team**. No Teams, Finance or HR.
- **HR:** Dashboard, My workplace, HR, Tasks. Teams has been hidden since 15 Nov 2026. Leads, Clients, Projects, Inventory and Bookings are hidden.
- **Accountant:** Dashboard, Clients, Projects, Inventory, My workplace, Bookings, Finance, Tasks. Leads and HR are hidden.
