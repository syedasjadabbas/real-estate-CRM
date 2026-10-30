# Projects Module — Implementation Notes (Phase 1)

Status: **implemented and verified against PostgreSQL** (29 Oct 2026). Sources: `REQUIREMENTS.md` FR-060–062 · `MODULES_AND_FEATURES.md` §4 · `DATA_MODEL.md` §3 · `USER_ROLES_AND_PERMISSIONS.md` (Projects) · `API_DESIGN.md` (Projects and inventory) · `REVERSE_ENGINEERING_REPORT.md` §2.

## 1. Evidence and assumptions

The reference could not be re-opened in this milestone (browser extension not connected). Evidence comes from the 28 Oct inspection as a Sales Agent.

| Item | Basis |
|---|---|
| KPI tiles: Projects · Units tracked · Project types | OBSERVED |
| Card: name, type badge, INACTIVE badge, company label, units tracked, Open → | OBSERVED |
| Inactive projects visible on the Projects page to an agent | OBSERVED (the agent saw INACTIVE cards) |
| Detail page | NOT OBSERVED (Access denied). Built in the Lead/Client detail layout; marked ASSUMED |
| Fields: name, type, developer / company, city, address, status, description | FR-060 + DATA_MODEL §3 |
| Search fields (name, developer, city), type and status filters, 24 cards per page | ASSUMED (reference had 4 projects) |
| Linked records: leads and clients counted within the viewer's own scope | ASSUMED presentation of documented links (leads belong to a project; clients link through leads) |

## 2. Decisions confirmed by the user (29 Oct 2026)

1. **Inventory dimensions (FR-061)** are built with the Inventory module, not here. The detail page says so.
2. **Project selector:** super admin / admin also see inactive projects, labelled "(inactive)". Managers, agents and accountants see active ones only. New leads still require an active project; the Add lead form falls back to the first active project.
3. **List layout:** cards, as in the reference.

Not built (undocumented or out of scope): delete, `default_rate_per_sqft` (inferred app setting, belongs with Bookings). **Update:** units tracked is now shown (from Inventory).

## 3. Data (migration `drizzle/0002_projects.sql`, additive only)

- `projects.address` and `projects.description` (text, nullable).
- `projects_name_lower_uq`: unique index on `lower(name)`, so names are unique ignoring case. Checked for existing collisions before applying (none).
- Every create / edit writes `audit_logs` (`entity = 'project'`; actions `project.create`, `project.update`, `project.activate`, `project.deactivate`) with before / after values.

## 4. Permissions (server-side, `src/modules/projects/policy.ts`)

| Role | View list and detail | Create / edit / (de)activate | Inactive in selector |
|---|---|---|---|
| Super Admin / Admin | ✓ | ✓ | ✓ |
| Manager / Agent / Accountant | ✓ (read-only form) | — | — |
| HR | — | — | — |

## 5. Screens and API

- `/dashboard/projects` (KPIs, toolbar, cards, pagination), `/dashboard/projects/new` (admins), `/dashboard/projects/[id]` (facts, edit form, linked records, inventory placeholder). Each has a `loading.tsx`.
- "Open leads" on a project switches the header project, then opens Leads.
- API: `GET/POST /api/v1/projects`, `GET/PATCH /api/v1/projects/:id`.
- Header selector, `setActiveProjectAction` and `?projectId=` on Leads APIs now share `selectableProjects()`.

## 6. Verification (29 Oct 2026)

| Check | Result |
|---|---|
| Migration | Drift check clean; applied to `mz_crm` and `mz_crm_test`; lead, client and project counts unchanged |
| Tests | 73/73: unit 22 Leads + 8 Clients + 7 Projects; PostgreSQL 18 Leads + 11 Clients + 7 Projects (none skipped) |
| Browser (admin) | Case-variant duplicate name rejected; project created with all fields; city edited and project deactivated; values persisted after reload (also checked in PostgreSQL with audit rows); filters and empty state; Add lead defaults to an active project while an inactive one is selected |
| API matrix | agent / manager read-only (403 on create/edit, 400 for an inactive `projectId`); admins full; HR 403; signed out 401; cross-origin 403 |
| Layout | No horizontal overflow at 375 / 768 / 1440 px on all Projects routes |
| Console / server log | No errors |
| Typecheck, lint, build | Pass |

Screenshots could not be captured in this pass (the browser pane was not drawing); the UI was exercised through the DOM and accessibility tree instead.

## 7. Open items

- FR-061 inventory dimensions and "Units tracked" arrive with Inventory.
- Confirm whether projects may be deleted or renamed after leads exist (rename is allowed today; there is no delete).

## 8. Updates from the Inventory milestone (29 Oct 2026)

- "Units tracked" (KPI, cards, detail) now counts real units; FR-061 dimensions are edited on the project detail page (see `INVENTORY_MODULE_PLAN.md`).
- Bug fixed: the Add project form's defaults were imported by the server page from a `"use client"` module and arrived as a client reference, so fields started uncontrolled. Moved to `features/projects/defaults.ts`.
