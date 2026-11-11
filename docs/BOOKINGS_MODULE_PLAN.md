# Bookings Module — Implementation Notes (Phase 1)

Status: **confirmed scope implemented and verified against PostgreSQL** (29 Oct 2026). Sources: `REQUIREMENTS.md` FR-050, FR-071–072, FR-080–085, FR-202–206 · `MODULES_AND_FEATURES.md` §6 · `DATA_MODEL.md` §5, §9 · `USER_FLOWS.md` §5 · `API_DESIGN.md` (Bookings) · `USER_ROLES_AND_PERMISSIONS.md` · `ASSUMPTIONS_AND_OPEN_QUESTIONS.md` Q-B1–Q-B7. The reference could not be re-opened (browser extension not connected).

## 1. Phase 1 findings

| Topic | Status |
|---|---|
| New booking fields (project, lead, available unit, per-sq-ft rate PKR, token PKR, buyer payment instructions) | OBSERVED (FR-080) |
| Create → unit Reserved, lead Booking in Process | OBSERVED / FR-071 |
| 10 stages; Cancelled from any stage; invalid jumps blocked | OBSERVED / FR-082 |
| Overview: total, paid / total, 30% milestone (met when paid ≥ 30%), reserved until, agreement sent, payment docs | OBSERVED / FR-083 |
| One active booking per unit | DATA_MODEL |
| Token → hold-duration formula, auto-release | **Q-B2 open** |
| Mandatory stages, gates, who moves each | **Q-B3 open** |
| Unit Booked vs Sold timing | **Q-B4 open** |
| SPU / 50% share booking and pricing | **Q-B1 open** |
| Provisional receipt / Sales order templates and numbering | **Q-B5 open** |
| Payments, methods, receipt numbers, reversals | FR-202–206 (NEW, unconfirmed Finance module) |
| Booking permission matrix | PROPOSED in the docs |

## 2. Decisions confirmed by the user (29 Oct 2026)

1. **Hold:** "Reserved until" defaults to 7 days after creation and can be changed (not in the past). Since 11 Nov 2026 (client rule of 10 Nov) an unpaid hold past its date, still in Negotiation or Token pending with no payment, is released by `npm run job:release-holds`: the booking is cancelled "Hold expired" and the unit returns to Available (`DEPLOYMENT_PROXY.md` §7b).
2. **Stages:** forward one step at a time, no skipping, no going back; every move logged with an optional note. No payment or document gates.
3. **Confirm:** unit → Booked (Sold stays a manual admin status for units without an active booking), lead → Booked, client created or linked by phone (FR-050; one client per phone).
4. **Payments:** deferred to Finance at the time. **Update:** Finance F1/F2 now posts payments, and the booking page takes Paid and the 30% milestone from them.
5. **Provisional receipt / Sales order:** placeholder tabs; no document numbers issued.
6. **Cancel:** unit → Available; the lead stays where it is.
7. **Total sale = area (snapshot at booking) × rate**, no discount; rate > 0, token > 0, token ≤ total.
8. **Permissions:** the proposed matrix (below).

Added safeguards (not business rules): rate and token are fixed after creation (cancel and rebook to change); an admin cannot override the status of a unit that has an active booking.

## 3. Data (migration `drizzle/0004_bookings.sql`, additive only)

- Enums `booking_stage`, `payment_docs_status`.
- `bookings`: project, unit, lead, client (set on confirm), agent (lead owner at creation), rate_per_sqft, area_sqft (snapshot), total_sale, token_amount, reserved_until, stage, stage_changed_at, payment_instructions, agreement_sent_on, payment_docs_status, confirmed_at, cancelled_at, cancelled_reason, created_by, timestamps.
- Constraints: **partial unique index `bookings_one_active_per_unit_uq` on unit_id where stage ≠ cancelled**; rate / area / token > 0; token ≤ total; cancelled ⇔ cancelled_at set; cancelled requires a reason.
- `booking_stage_history` (from, to, actor, note, time) plus `audit_logs` (`booking.create / stage / confirm / cancel / update`), unit status audit (`source: booking`), lead stage audit and client audit.

## 4. Concurrency and integrity

- Create claims the unit with the guarded compare-and-set transition (`Available → Reserved`, whole units only) inside the booking transaction; the partial unique index is the database backstop. Lock order is unit → lead (create) and booking → unit → lead (confirm) to avoid deadlocks.
- Stage writes are guarded on the stage the caller saw; the booking row is locked for the move.
- Verified: two concurrent creates on one unit → one 201, one 409 (live API and integration test); the loser's lead is untouched. Two concurrent moves on one booking → one succeeds.

## 5. Permissions (`src/modules/bookings/policy.ts`; scope = booking's sales agent)

| Role | View | Create | Move stage | Confirm | Cancel | Edit overview fields |
|---|---|---|---|---|---|---|
| Super Admin / Admin | all | ✓ | ✓ | ✓ | ✓ | ✓ |
| Manager | team | team leads | ✓ | ✓ | ✓ | ✓ |
| Agent | own | own leads | up to Sales order | — | — | — |
| Accountant | all (read) | — | — | — | — | — |
| HR | — | — | — | — | — | — |

## 6. Screens and API

- `/dashboard/bookings` (search lead / code / phone / unit, project, stage; Lead, Sales agent, Unit, Project, Stage, Paid, Updated, Open), `/dashboard/bookings/new` (lead pre-selected from a lead page), `/dashboard/bookings/[id]` (Overview · Provisional receipt · Sales order tabs). Each has a `loading.tsx`.
- Lead page: Bookings panel with "Start booking →". Unit page: Booking history. Client page: Investments.
- API: `GET/POST /api/v1/bookings`, `GET/PATCH /api/v1/bookings/:id`, `POST /api/v1/bookings/:id/stage`, `POST /api/v1/bookings/:id/cancel`.

## 7. Verification (29 Oct 2026)

| Check | Result |
|---|---|
| Migration | Drift check clean; applied to both databases; all counts unchanged |
| Tests | 107/107: unit 22 + 8 + 7 + 7 + 5; PostgreSQL Leads 18, Clients 11, Projects 7, Inventory 10, Bookings 12 (none skipped) |
| Browser (admin) | Booking created from the form (lead pre-selected, only Available whole units offered, total preview 674.5 × 25,000 = PKR 16,862,500, oversized token rejected); moved through all 7 stages with a note; overview fields saved; confirmed → unit Booked, lead Booked, client created and linked; second booking cancelled with a reason → unit Available, lead unchanged; all persisted after reload and in PostgreSQL |
| API matrix (9 sessions) | scopes as above; HR 403; signed out 401; cross-origin 403; cancel confirmed / advance cancelled / override booked unit → BUSINESS_RULE |
| Layout | No horizontal overflow at 375 / 768 / 1440 px on Bookings routes and the lead / unit pages |
| Server log / console | No errors |
| Typecheck, lint, build | Pass |

Notes: the browser pane was hidden, so the top-level page did not hydrate; UI steps ran inside a same-origin iframe in that tab (real pages, real server actions). The dev server was restarted after the migration (route handlers keep pre-migration modules otherwise, as seen in the Inventory milestone).

## 8. Open business decisions / remaining work

- Q-B2 hold formula and auto-release; Q-B3 stage gates (which stages need a payment or document); Q-B4 when a unit becomes Sold; Q-B1 SPU / 50% booking; Q-B5 receipt and sales-order templates and numbering.
- Finance module (FR-200–206): payment recording, receipt numbers, reversals, outstanding balance; Paid and the 30% milestone then become real.
- Whether a lead may hold more than one active booking (not restricted today; undocumented).
- Whether the lead should move back on cancellation (left as is by decision).
