# Inventory Module — Implementation Notes (Phase 1)

Status: **implemented and verified against PostgreSQL** (29 Oct 2026). Sources: `REQUIREMENTS.md` FR-061, FR-070–075 · `MODULES_AND_FEATURES.md` §5 · `DATA_MODEL.md` §3 · `USER_ROLES_AND_PERMISSIONS.md` (Inventory) · `API_DESIGN.md` · `USER_FLOWS.md` §4–5 · `ASSUMPTIONS_AND_OPEN_QUESTIONS.md` Q-B1, Q-B4, Q-P5.

## 1. Evidence and assumptions

The reference could not be re-opened (browser extension not connected). Evidence is the 28 Oct inspection (list only; the unit detail page did not load).

| Item | Basis |
|---|---|
| Columns #, Project, Floor, Unit, Sale model, Area, Base price, Nature, Category, Status, Type, Bed, Comment, Date | OBSERVED (built) |
| Column "Sales" | OBSERVED but meaning unknown, **not built** |
| Statuses Available / Partially booked / Reserved / Booked / Sold | OBSERVED + FR-071 |
| Sale models Whole unit / SPU strips / 50% fractional | OBSERVED + FR-072 |
| Filters search, Project, Status, Nature, Sale model | OBSERVED + FR-073 |
| List defaults to the header project, "All projects" option | ASSUMED (reference scopes lists by the header project and also has a Project filter) |
| Search fields (unit, floor, block, category, type, comment), order (project, floor, unit), 50 per page | ASSUMED |
| Base price currency PKR, area in sq ft | ASSUMED (sq ft is documented; currency is not) |
| Unit detail layout | ASSUMED (Lead/Client/Project detail pattern) |

## 2. Decisions confirmed by the user (29 Oct 2026)

1. **Status before Bookings:** new units start Available; admins may override status with a required reason (audited). "Partially booked" only for SPU / 50% units (FR-072).
2. **SPU / 50% fractional:** the sale model is recorded and filterable only. No share rows, share pricing or share status until Q-B1 is answered.
3. **Dimensions (FR-061):** admins keep per-project lists (floors, blocks, categories, types, premiums) on the project page. A non-empty list restricts the unit field (matched ignoring case, stored in the configured spelling); an empty list allows free text. Only changed fields are re-checked on edit, so removing a value doesn't lock older units.
4. **CSV import (FR-075):** deferred until the client provides an export or template (Q-P5).

Not built: unit delete (undocumented), "Sales" column, share-level booking.

## 3. Data (migration `drizzle/0003_inventory.sql`, additive only)

- Enums `unit_sale_model` (`whole`, `spu`, `fractional_50`), `unit_status`.
- `units`: project (FK, restrict), unit_no, floor, block, sale_model, area_sqft numeric(12,2), base_price numeric(15,2), nature, category, type, bedrooms, premium, status, status_changed_at, comment, listed_on (date), created_by, timestamps.
- Constraints: unique `(project_id, lower(unit_no))`; `area_sqft > 0`; `base_price >= 0`; `bedrooms >= 0`; `status <> 'partially_booked' or sale_model <> 'whole'`. Indexes `(project_id, status)`, `(project_id, floor)`.
- `projects.dimension_config` jsonb NOT NULL default `{}`.
- History: `audit_logs` with `entity = 'unit'` (`unit.create`, `unit.update`, `unit.status` with before / after, source and reason) and `project.dimensions`.

## 4. Bookings readiness (no bookings or payments created)

- `modules/inventory/status.ts → transitionUnitStatus()` is the only way to change status: one compare-and-set `UPDATE … WHERE id = ? AND status IN (…)`. Concurrent callers serialise on the row lock; the loser gets `CONFLICT`. It writes the audit row in the same transaction.
- `reserveAvailableUnit()` is the hook for "creating a booking sets the unit to Reserved" (FR-071). It accepts whole units only until Q-B1 defines share booking.
- Tested with two truly concurrent transactions against PostgreSQL: exactly one succeeds, one audit row.
- Still open for Bookings: Q-B4 (when Reserved → Booked → Sold), Q-B1 (shares), whether the admin override stays once bookings exist.

## 5. Permissions (`src/modules/inventory/policy.ts`)

| Role | View | Create / edit / status override / dimensions |
|---|---|---|
| Super Admin / Admin | ✓ | ✓ |
| Manager / Agent / Accountant | ✓ (read-only) | — |
| HR | — | — |

## 6. Screens and API

- `/dashboard/inventory` (toolbar + table + pagination), `/dashboard/inventory/new` (admins), `/dashboard/inventory/[id]` (facts, edit form, status panel, history, booking-history placeholder, shares note for split units). Each has a `loading.tsx`.
- Project detail: "Inventory dimensions" panel and a working "View inventory" link; Projects "Units tracked" now counts units.
- API: `GET/POST /api/v1/units`, `GET/PATCH /api/v1/units/:id`, `POST /api/v1/units/:id/status`, `PUT /api/v1/projects/:id/dimensions`.

## 7. Verification (29 Oct 2026)

| Check | Result |
|---|---|
| Migration | Drift check clean before generating; applied to `mz_crm` and `mz_crm_test`; lead / client / project / audit counts unchanged |
| Tests | 90/90: unit 22 Leads + 8 Clients + 7 Projects + 7 Inventory; PostgreSQL 18 Leads + 11 Clients + 7 Projects + 10 Inventory (none skipped) |
| Browser (admin) | Dimensions saved; unit created (zero area rejected, case-variant duplicate rejected); price edited; status overridden with reason; values and history persisted after reload and in PostgreSQL; SPU unit set to Partially booked (option absent for whole units); every filter and the empty state checked |
| API matrix | agent / manager / verification agent read 200, write 403; HR 403; admins 200 / 400 for invalid input; signed out 401; cross-origin 403; same-status and partial-on-whole return BUSINESS_RULE |
| Layout | No horizontal overflow at 375 / 768 / 1440 px on all Inventory routes and the Projects pages |
| Console / server log | No errors after the fixes below |
| Typecheck, lint, build | Pass |

Fixed during verification:
- **Create forms started uncontrolled** (Inventory and Projects): the blank-form defaults lived in `"use client"` modules, so the server pages received client references instead of objects. Moved to `features/{inventory,projects}/defaults.ts`. Projects creation had only worked because the server applied its own defaults.
- The dev server's route handlers kept pre-migration modules after the schema change (API 500s while pages worked). A clean restart fixed it; the production build was never affected.

Screenshots were not possible (the browser pane was not drawing); the UI was exercised through the DOM and accessibility tree.

## 8. Open items

- Q-B1 (SPU / 50% share sizing, pricing, booking, "Sold"), Q-B4 (status timing), meaning of the "Sales" column, currency confirmation.
- FR-075 CSV import once a SaleStorm export or template is available.

## 9. Updates from the Bookings milestone (29 Oct 2026)

- Bookings now reserve units through `reserveAvailableUnit()` and confirm / cancel through `transitionUnitStatus()` (see `BOOKINGS_MODULE_PLAN.md`). Its conflict message now reads "This unit is no longer available (it is …)".
- The admin status override is refused while a unit has an active booking; the unit page lists the unit's bookings.
