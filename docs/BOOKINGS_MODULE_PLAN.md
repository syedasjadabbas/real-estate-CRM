# Bookings Module — Implementation Notes (Phase 1)

Status: **confirmed scope implemented and verified against PostgreSQL** (29 Oct 2026). **Updated 16 Nov 2026:** four stages with required steps, price from inventory with a discount, demo printables, list stage cards and filters. See §9; it replaces older statements below where they differ. Sources: `REQUIREMENTS.md` FR-050, FR-071–072, FR-080–085, FR-202–206 · `MODULES_AND_FEATURES.md` §6 · `DATA_MODEL.md` §5, §9 · `USER_FLOWS.md` §5 · `API_DESIGN.md` (Bookings) · `USER_ROLES_AND_PERMISSIONS.md` · `ASSUMPTIONS_AND_OPEN_QUESTIONS.md` Q-B1–Q-B7. The reference could not be re-opened (browser extension not connected).

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
2. **Stages:** forward one step at a time, no skipping, no going back; every move logged with an optional note. No payment or document gates. *Superseded 14 Nov 2026: four stages, and the payment moves need an amount, a payment proof and a signed booking form (§9).*
3. **Confirm:** unit → Booked (Sold stays a manual admin status for units without an active booking), lead → Booked, client created or linked by phone (FR-050; one client per phone).
4. **Payments:** deferred to Finance at the time. **Update:** Finance F1/F2 now posts payments, and the booking page takes Paid and the 30% milestone from them.
5. **Provisional receipt / Sales order:** placeholder tabs; no document numbers issued. *14 Nov 2026: demo printables now exist, still with no numbers (§9).*
6. **Cancel:** unit → Available; the lead stays where it is.
7. **Total sale = area (snapshot at booking) × rate**, no discount; rate > 0, token > 0, token ≤ total. *Superseded 14 Nov 2026: the price comes from the unit's inventory price less a discount, and the token is at least PKR 20,000 (§9).*
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
| Agent | own | own leads | up to Complete Down Payment | — | — | — |
| Accountant | all (read) | — | — | — | — | — |
| HR | — | — | — | — | — | — |

*16 Nov 2026:* the Manager role is merged into Admin (13 Nov 2026), so the Manager row only applies to old accounts. Agents now move bookings up to **Complete Down Payment**; Closed Won is for Admins and Super Admins. Accountants and Super Admins can also reject a booking whose token payment isn't genuine (§9).

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

- Q-B2 hold formula and auto-release; Q-B3 stage gates (which stages need a payment or document); Q-B4 when a unit becomes Sold; Q-B1 SPU / 50% booking; Q-B5 receipt and sales-order templates and numbering. *16 Nov 2026: Q-B2 is settled (7-day hold, release job, §2) and Q-B3 by the four stages and their steps (§9). Q-B4, Q-B1 and Q-B5 are still open.*
- Finance module (FR-200–206): payment recording, receipt numbers, reversals, outstanding balance; Paid and the 30% milestone then become real. *Done: Finance posts payments and the booking page reads Paid and the milestone from them (§2).*
- Whether a lead may hold more than one active booking (not restricted today; undocumented).
- Whether the lead should move back on cancellation (left as is by decision).

## 9. Update, 16 Nov 2026

What Bookings does now, after the changes of 14–16 Nov 2026 (owner's decisions and review). Where this differs from the sections above, this section wins.

**Stages** (migration `0036_booking_stages`, `src/modules/bookings/constants.ts`)
- Four stages: **Token → Partial Down Payment → Complete Down Payment → Closed Won**, plus Cancelled. They are stored as `token_pending`, `down_payment`, `agreement_pending` and `confirmed`. Open bookings in the retired stages (Negotiation, Token received, Provisional receipt, Sales order, Booking form) were moved to Token; the old values stay only so old history keeps its labels.
- Still one step at a time, no skipping, no going back. Closed Won still makes the unit Booked, the lead Booked and links the client.

**Steps on the booking page** (enforced on the server)
- New booking: a token of at least PKR 20,000, with an optional transfer screenshot saved to the booking's payment proofs.
- Moving to Partial or Complete Down Payment needs the **amount received** and a **new payment proof** uploaded in that stage.
- Leaving Partial or Complete Down Payment needs the **booking form signed by the client**, uploaded during that stage (Signed booking form panel: PDF, JPG, PNG, DOCX or XLSX up to 10 MB; also listed in the lead's Documents; audited).
- The Stage card shows each step with a tick when done.

**Price and discount** (migration `0040_booking_discount_approval`)
- Picking a unit shows its inventory price. The total is the unit's inventory price less **Discount %**; the rate per sq ft is worked out from it. A unit with no price still takes a typed rate.
- Agents give up to their cap (5%, from Proposal settings) themselves. The hint says "Up to 5% for your role; more needs an Admin's approval", or "No limit for your role" for Admins and Super Admins.
- Above the cap, the booking is created at the cap with the asked discount **pending**. Admins and Super Admins are notified, and the booking can't move stage until it is decided. Approve moves the price to the asked discount (unless more is already paid); Reject, with a reason, keeps the cap. The agent is notified either way.

**Payment rejection by Accounts**
- Accountants and Super Admins can reject a booking whose token payment isn't genuine, before any payment is posted. The booking is cancelled with the reason, the unit is freed and the agent gets a `booking_rejected` notification.

**Printables and payment plans**
- Booking form (demo), demo provisional receipt (with image proofs) and demo sales order: A4 layouts filled from the booking, marked DEMO, issuing no number and recording nothing, until the client's templates arrive (Q-B5).
- Each project can have its own payment plan (migration `0042_project_payment_plan`: down payment %, installments, how often, balloons, possession). New booking and the printables use it; missing parts fall back to the Proposal settings.

**Bookings list** (`/dashboard/bookings`)
- Header: "Token → down payment → Closed Won. The unit stays held in Inventory while a booking is open."
- One clickable **card per stage** with its count and total sale value, for the user's scope and the chosen project. Clicking a card filters to that stage; clicking it again clears it.
- New filters: **Agent** (when more than one), **Team** (for roles that see every booking) and **Booked from / to** (the date the booking was created). The empty message says when no booking matches the filters.

**Booking detail**
- A closed booking shows "Reserved until" as **Sold** (Closed Won) or **Released** (Cancelled) instead of the old hold date.

**New booking**
- The unit is chosen with a **searchable picker** (the same picker as the lead search), searching unit number or floor.

**Fixed 16 Nov 2026:** an agent moving a booking too far now sees "Agents can move a booking up to Complete Down Payment; an Admin takes it further."
