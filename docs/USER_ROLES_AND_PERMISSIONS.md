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
| Leads: reassign | F | F | T | — | — | — |
| Leads: mark lost | F | F | T (approve) | O (request) | — | — |
| Leads: delete | F | — | — | — | — | — |
| Leads: merge duplicates | F | F | T | — | — | — |
| Clients | F | F | T | O | — | R |
| Projects: view | F | F | R | R | — | R |
| Projects: create / edit | F | F | — | — | — | — |
| Inventory: view | F | F | R | R | — | R |
| Inventory: edit / import | F | F | — | — | — | — |
| Bookings: create | F | F | T | O | — | — |
| Bookings: change stage | F | F | T | O (up to Sales order) | — | R |
| Bookings: confirm / cancel | F | F | T | — | — | — |
| Tasks | F | F | T | O | O (assigned to them; no create) | O (assigned to them; no create) |
| Proposal discount | any | any | ≤ manager cap | ≤ agent cap (5%) | — | — |
| Meetings | F | F | T | O | — | — |
| Targets: set | F | F | T | — | — | — |
| Targets: view | F | F | T | O | — | — |
| Teams / daily report / roster | F | F | T | R (own roster) | R | — |
| HR employees / holidays | F | F | R | — | F | — |
| HR records without a CRM login (Q1) | F | F | R | — | F | — |
| Leave: request | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Leave: approve | F | F | T | — | F | — |
| Performance | F | F | T | O | — | — |
| Accounts & Finance | F | R | — | — | — | F |
| CRM accounts: create, role, password, deactivate, lead shift (Q2, Q3) | F | F, except Super Admin accounts (C-1) | — | — | — | — |
| Recordings: delete (Q53; hides, file kept) | F | — | — | — | — | — |
| Settings, users, roles | F | users only | — | — | — | — |
| City list (FR-042, S-22) | F | F | — | — | — | — |
| Audit log | F | R | — | — | — | — |
| Lead import batches: submit (Admin and Super Admin only since 13 Nov 2026) | F | F | — | — | — | — |
| Lead import batches: approve / reject | F | — | — | — | — | — |
| Claim an unassigned lead | — | — | F | F | — | — |
| Assignment weights and thresholds | F | F | — | — | — | — |
| Backups page (read-only; restore only on the server) | F | — | — | — | — | — |

**Changes from the client questionnaire (implemented 3 Nov 2026):** Tasks for HR and Accountants (Q45), HR records without logins (Q1), account management (Q2, Q3) and recording deletion (Q53).

**Not yet applied:** the answers that *remove* access wait for the signed questionnaire (S-1) and stay as shown above:
- Manager reversal approval (Q31);
- agent recording playback (Q52);
- proposal editing limited to Super Admin (Q36);
- task assignment limited to Admins (Q45).

### Enforcement rules (PROPOSED)

1. Permissions are enforced on the **server** for every request. Hiding UI elements is cosmetic only.
2. **Record scope** is applied in queries: `own` = `ownerId = me`; `team` = owner in the teams I manage; `all` = no filter. The project scope is always applied as well.
3. Approval actions (lost, leave, discount above the cap) create an approval record with the approver and a timestamp.
4. Role changes and permission denials are written to the audit log.

## 3. Questions to confirm

See `ASSUMPTIONS_AND_OPEN_QUESTIONS.md`: Q-R1 to Q-R6.

## Sidebar per role (10 Nov 2026)
The sidebar shows only the modules a role can open. Each item's role list (`src/config/navigation.ts`) matches the page's own check, and `tests/unit/navigation-roles.test.ts` keeps them equal. **No permission changed:** pages and APIs still check access, and an address typed by hand still shows Access denied.
- **HR:** Dashboard, My workplace, HR, Teams, Tasks. Leads, New leads, Clients, Projects, Inventory and Bookings are hidden.
- **Accountant:** Dashboard, Clients, Projects, Inventory, My workplace, HR, Bookings, Finance, Tasks. Leads and New leads are hidden.
- **Other roles:** unchanged.
