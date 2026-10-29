# Accounts & Finance Module — Phase 1 Plan (awaiting approval)

Status: **plan approved 29 Oct 2026; F1 (booking payments) implemented on proposed defaults — see §9. F2–F5 not started.** Prepared 29 Oct 2026 after reviewing `REQUIREMENTS.md` §14 (FR-200–206), `MODULES_AND_FEATURES.md` Part B, `DATA_MODEL.md` §9, `SECURITY_AND_PRIVACY.md` §8, `USER_ROLES_AND_PERMISSIONS.md`, `API_DESIGN.md` (Finance), `IMPLEMENTATION_ROADMAP.md` (P6), `ASSUMPTIONS_AND_OPEN_QUESTIONS.md` (Q-F1–F6, Q-B3, Q-B5, Q-B6), `BOOKINGS_MODULE_PLAN.md` and the current schema and code.

**Reference:** none exists. Finance is *"not present in the reference CRM"* (MODULES Part B; reverse-engineering item B-12). Nothing below is reference behaviour; everything is either a written requirement or a proposal.

---

## 1. Confirmed requirements vs assumptions

### 1.1 Written requirements (FR-200–206, marked NEW; Part B says "all items PROPOSED and need business confirmation")

| ID | Requirement | Acceptance |
|---|---|---|
| FR-200 | Income records: category, amount, date, method, reference, attachment | Finance role only |
| FR-201 | Expense records: category, payee, amount, date, method, reference, attachment | — |
| FR-202 | Record booking payments (token, down payment, installment) against a booking | Booking "Paid" and the 30% milestone update automatically |
| FR-203 | Outstanding per booking = total − received; overdue vs schedule | Correct after each payment |
| FR-204 | Payment history per booking and per client, with receipt numbers | — |
| FR-205 | Reports: income vs expense by month, collections by project, outstanding by project / agent; CSV export | Totals reconcile with records |
| FR-206 | No hard deletes; corrections via reversal entries | Audit shows original and reversal |
| FR-083 | 30% milestone "Met" when paid ≥ 30% of total | (Bookings, already built against paid = 0) |
| NFR-06 | PKR currency; Asia/Karachi shown, UTC stored | — |

### 1.2 Already decided elsewhere (stated in project docs)

| Rule | Source | Status |
|---|---|---|
| Payments / entries never hard-deleted; reversals linked to the original | SECURITY §8, FR-206 | Requirement |
| Totals recomputed from entries, never typed by hand | SECURITY §8 | Requirement |
| Only Accountant and Super Admin write finance data; Admin reads | SECURITY §8 + matrix "Accounts & Finance F/R/—/—/—/F" | PROPOSED matrix |
| Exports limited to admin / accountant and audited | SECURITY §8–9 | PROPOSED |
| Payment writes accept an `Idempotency-Key` | API_DESIGN | PROPOSED |
| "Sequential receipt numbers; no gaps on reversal" | SECURITY §8 | PROPOSED, **format unknown (Q-F3)** |
| No double-entry ledger, tax, bank integration, payment gateway | A-08 / quotation | Out of scope |
| Payroll | Q-F6 | Proposed **excluded** |
| Payment types token / down_payment / installment / other | DATA_MODEL §9 | Draft model |
| Methods cash / bank transfer / cheque / online | DATA_MODEL §9 | **⚠ unconfirmed** |

### 1.3 Not documented anywhere (must not be invented)

Receipt number format; payment-method list; income / expense categories; whether overpayment is allowed; whether payments are allowed on cancelled or not-yet-token bookings; what happens to payments when a booking is cancelled (refund?); whether recording a payment moves the booking stage (Q-B3); the installment schedule that "overdue" is measured against (Tasks payment plan, not built; Q-B6); maker-checker (Q-F2); whether agents / managers see itemised payments; attachment storage; multi-currency (Q-F5).

---

## 2. Proposed database model and migration strategy

All tables additive in one migration (`0005_finance`), applied with the usual drift check to `mz_crm` and `mz_crm_test`. No existing table changes except reading `bookings`. Existing bookings keep showing **PKR 0 paid** because there are no rows, which is the truth; nothing is back-filled.

### 2.1 `booking_payments` (FR-202, FR-204, FR-206)

| Column | Type | Notes |
|---|---|---|
| id | uuid | |
| booking_id | uuid FK → bookings, `ON DELETE RESTRICT` | |
| kind | enum `payment`, `reversal` | |
| type | enum `token`, `down_payment`, `installment`, `other` | payments only; reversal copies the original's type |
| amount | numeric(15,2), `> 0` | always positive; a reversal subtracts |
| received_on | date | business date (Asia/Karachi); not in the future |
| method | enum — **pending Q-F7** | |
| reference | text | cheque / transaction no. |
| note | text | required on reversals (reason) |
| reversal_of_id | uuid FK → booking_payments, **unique** | set only on reversals; one reversal per payment |
| receipt_seq | bigint, unique | **pending Q-F3** (who gets a number, format) |
| idempotency_key | text, unique per recorder | prevents double submission |
| recorded_by_id, recorded_at | | |

Constraints: `(kind = 'reversal') = (reversal_of_id is not null)`; `kind = 'reversal' → note is not null`; amount > 0; a reversal's amount equals the original's (enforced in the service and by a trigger). Indexes: `(booking_id, received_on)`, `(received_on)`.

**Immutability:** a `BEFORE UPDATE OR DELETE` trigger on `booking_payments` raises an exception, so even a bug or a manual query cannot silently edit or erase a financial record. Corrections are reversal rows only (FR-206). Partial corrections = reverse in full, then record the right amount (no "edit").

**Paid** = `sum(payment) − sum(reversal)` per booking, computed from rows (SECURITY §8). No cached column, so it can never drift; at ≤ 10 users and thousands of rows an indexed `SUM` is fast. (If needed later, a cached `paid_total` maintained inside the same transaction can be added.)

### 2.2 `receipt_counters` (if receipts are numbered — Q-F3)

One row per sequence (e.g. per year or per project, depending on the answer). Postgres sequences leave gaps on rollback, so a gap-free number is taken by `SELECT … FOR UPDATE` on the counter row inside the payment transaction. Only the integer is stored; the printed format is applied at display time once approved.

### 2.3 Income / expense (FR-200, FR-201)

`finance_categories (kind income|expense, name, is_active)`, unique `(kind, lower(name))`; `income_records` and `expense_records` with the same immutability trigger, reversal pattern, amount > 0, method, reference, optional project / booking (income) or payee (expense), recorded_by. **Attachments** need file storage that does not exist yet (Q-F9).

### 2.4 Not modelled until confirmed

Installment schedules / overdue (needs the Tasks payment plan, Q-B6 / business rule 5); refunds (Q-F10); multi-currency (Q-F5); payroll (Q-F6).

---

## 3. Transaction safety and validation

- **Recording a payment:** one transaction that (1) locks the booking row `FOR UPDATE`, (2) checks the booking's state against the approved rule (Q-F11), (3) computes the current paid total from rows, (4) validates the amount against the outstanding balance per the approved overpayment rule (Q-F12), (5) takes the next receipt number from the locked counter (if numbered), (6) inserts the row, (7) writes `audit_logs`. Two concurrent payments on one booking serialise on the booking lock, so the second sees the first's amount — totals cannot be inconsistent.
- **Reversing:** locks the booking and the original payment; refuses if already reversed (unique `reversal_of_id`) or if the target is itself a reversal; inserts the reversal; audits both ids.
- **Idempotency:** a repeated request with the same key returns the first result instead of creating a second payment.
- **Amounts:** PKR, > 0, at most 2 decimals, upper bound; received_on not in the future (backdating limit: Q-F13).
- **Booking cancel interaction:** today cancel releases the unit. With payments present, cancel behaviour needs a rule (Q-F10); until then the plan proposes **blocking cancel while net paid > 0**, so money is never orphaned silently.
- Tests will include truly concurrent payments, double reversal, reversal of a reversal, update / delete attempts against the trigger, idempotent replays, and reconciliation (report totals = sum of rows).

---

## 4. Screens and workflow plan

Navigation: a new "Accounts & Finance" sidebar entry (the only sidebar change; the code already notes it is withheld until approval). Placement **Q-F14** (the reference has no slot for it). Visible only to roles with Finance access.

| Screen | Content |
|---|---|
| Finance → Payments | All booking payments (filters: project, booking / lead search, type, method, date range, include reversals); columns Receipt, Date, Lead, Unit, Project, Type, Method, Amount, Recorded by; "Record payment" |
| Record payment | Booking (search active bookings), type, amount, received on, method, reference; shows total / paid / outstanding before saving |
| Payment detail | Entry, receipt number, audit trail, linked reversal; "Reverse" with required reason |
| Outstanding | Per booking: total, paid, outstanding, milestone; filters project / agent / milestone not met (FR-203 without "overdue" until schedules exist) |
| Income / Expenses | Lists + forms (after Q-F4, Q-F9) |
| Reports | Income vs expense by month; collections by project; outstanding by project / agent; CSV export (audited) (FR-205) |
| Dashboard | Accountant "finance KPIs" (matrix "R (finance KPIs)"): collections this month, outstanding total — exact tiles Q-F15 |
| Printable receipt | After the template and numbering are confirmed (Q-F3 / Q-B5); A4 print layout (UI spec PrintLayout) |

Same layout, tokens, tables, toolbars, loading skeletons and empty states as the existing modules; no redesign.

---

## 5. Permission matrix (proposed, from the documents)

| Action | Super Admin | Admin | Manager | Agent | HR | Accountant |
|---|---|---|---|---|---|---|
| Finance screens (read) | ✓ | ✓ | — | — | — | ✓ |
| Record booking payment | ✓ | — | — | — | — | ✓ |
| Reverse payment | ✓ | — | — | — | — | ✓ (maker-checker? Q-F2) |
| Income / expense write | ✓ | — | — | — | — | ✓ |
| Categories manage | ✓ | — | — | — | — | ✓ (Q-F4) |
| Reports + CSV export | ✓ | ✓ | — | — | — | ✓ |
| Booking overview Paid / milestone (aggregate) | ✓ | ✓ | team | own | — | ✓ |
| Itemised payments on booking / client pages | ✓ | ✓ | ? | ? | — | ✓ (Q-F8) |

Server-enforced in a `modules/finance/policy.ts`, like every other module. Every write and every export is audited (`entity = 'payment' | 'income' | 'expense' | 'finance_export'`).

---

## 6. Integration points with Bookings

1. `modules/bookings/queries.ts` → replace the `money()` stub (`paid = 0`, `PAYMENTS_RECORDED = false`) with the real paid total from `booking_payments`; outstanding = total − paid; milestone = paid ≥ 30% of total (FR-083). The list's Paid column, the overview tiles and the client Investments list update automatically.
2. Booking detail: a **Payments** panel (history with receipt numbers, reversals shown linked) for allowed roles; the "Payments are recorded with the Finance module" note is removed.
3. Client detail "Payments & contracts" → per-client payment history (FR-204).
4. `cancelBooking` → apply the cancel-with-payments rule (Q-F10).
5. Provisional receipt tab → filled once the template, numbering and the link to the token payment are confirmed (Q-B5 / Q-F3).
6. No automatic booking stage changes from payments unless Q-B3 / Q-F16 says so.

---

## 7. Blocking questions for the client

| # | Question | Blocks |
|---|---|---|
| Q-F1 | Does Finance own booking payments and drive "Paid" on bookings? (Plan assumes yes, per FR-202.) | Everything |
| Q-F2 | Who records and who reverses payments? Is a second person needed to approve (maker-checker)? | Write permissions |
| Q-F3 | Receipt number format (prefix, year, per project?), does every payment get one, does a reversal get its own number, and is "no gaps" required? | Receipts |
| Q-F4 | Income and expense category lists; who may edit them | Income / expense |
| Q-F5 | PKR only? | Amount fields |
| Q-F6 | Payroll excluded? | Scope |
| Q-F7 | Payment methods list (draft: cash, bank transfer, cheque, online) | Method field |
| Q-F8 | Can managers / agents see itemised payments, or only the booking's Paid total? | Booking / client pages |
| Q-F9 | Attachments (receipt scans) required in V1? Storage is client-paid (object storage) | Income / expense, payments |
| Q-F10 | Booking cancelled after money was received: refund entry, keep as credit, or block cancel until reversed? | Cancel flow |
| Q-F11 | From which booking stages can payments be recorded (e.g. from Token pending)? Any on Confirmed (installments)? | Validation |
| Q-F12 | May payments exceed the outstanding balance? | Validation |
| Q-F13 | How far back may a payment be dated? | Validation |
| Q-F14 | Sidebar placement / label for Accounts & Finance | Navigation |
| Q-F15 | Which finance KPIs appear on the accountant's dashboard? | Dashboard |
| Q-F16 / Q-B3 | Should recording a token / down payment move the booking stage, or gate it? | Bookings integration |
| Q-B5 / Q-B6 | Receipt template; installment schedule source and defaults (needed for "overdue") | Printing, overdue |

## 8. Phased implementation and testing plan

| Phase | Scope | Depends on | Tests |
|---|---|---|---|
| F0 | Answers to Q-F1, F2, F3, F7, F10, F11, F12 (minimum to record payments) | Client | — |
| F1 | `booking_payments` + immutability trigger + receipt counter + record / reverse services + idempotency + audit; Bookings integration (Paid, outstanding, milestone, cancel rule) | F0 | Unit: validation, policy. PostgreSQL: record / reverse, concurrent payments on one booking, double reversal, reversal of reversal, trigger blocks UPDATE / DELETE, idempotent replay, milestone at 29.99% / 30%, paid after reversal, cancel-with-payments rule; Bookings regression |
| F2 | Finance UI: Payments list, record form, payment detail + reverse, Outstanding; booking Payments panel; client payment history; sidebar entry | F1 | Browser at 375 / 768 / 1440; persistence after reload; role checks per account (new verification accountant) |
| F3 | Categories, income, expenses (+ attachments if approved) | Q-F4, Q-F9 | Same pattern as F1 for both ledgers |
| F4 | Reports + CSV export (audited), dashboard KPIs | F1–F3, Q-F15 | Reconciliation: every report total equals the sum of its rows; export audit rows |
| F5 | Printable receipt (and provisional receipt tab) | Q-F3, Q-B5 | Print view per receipt; number gap-free under concurrency |
| Later | Overdue vs schedule | Tasks payment plan, Q-B6 | — |

Every phase: additive migration with drift check, full regression (Leads, Clients, Projects, Inventory, Bookings), lint, type-check, production build, no fabricated data (verification records labelled `VERIFY`).

---

## 9. F1 implementation (29 Oct 2026) — on proposed defaults, not confirmed client policy

### 9.1 Proposed defaults used (from the project owner, 29 Oct 2026)

| Question | Default applied | Needs client approval before real money is recorded? |
|---|---|---|
| Q-F1 | Finance is the single source of truth; Bookings derives Paid, outstanding and the 30% milestone from posted rows | Yes (confirms FR-202) |
| Q-F2 | Accountant (and super admin) records and requests reversals; manager (own team's bookings), admin or super admin approves; requester can't approve, except a super admin (emergency, audited as `payment.reversal_approved_emergency`) | **Yes** — maker-checker chain and the super-admin exception |
| Q-F3 | Every posted payment gets the next number from a database sequence (unique, never reused, gaps allowed); a reversal gets its own number from a second sequence and references the original receipt; display = configurable prefix + number (prefixes empty by default) | **Yes** — numbers issued in production are permanent; the format/prefix and whether gaps are acceptable must be confirmed first |
| Q-F7 | Cash, Bank Transfer, Cheque, Online Payment seeded; configurable (add / deactivate, never delete) | Yes (list) |
| Q-F10 | A booking with net payments > 0 cannot be cancelled. No refund, credit or retention entries exist | **Yes** — the resolution workflow (refund / credit / retention) is not built and must be specified |
| Q-F11 | Payments accepted from Token pending through Confirmed; refused in Negotiation and Cancelled | Yes |
| Q-F12 | Payments above the outstanding balance are rejected; no overpayment exceptions | Yes |

Not decided and not implemented: receipt template / printing (Q-B5, F5), refunds / credits / retention (Q-F10 detail), backdating limit (Q-F13; only "not in the future" is enforced), itemised visibility for agents (Q-F8; agents see the Paid total only), payment-driven stage changes (Q-F16: none), attachments (Q-F9), overdue vs schedule.

### 9.2 Delivered

- Migration `drizzle/0005_finance_payments.sql` (additive): `booking_payments`, `payment_reversal_requests`, `payment_methods` (+ 4 seeded rows), `finance_settings`, two sequences, and three triggers: payments are append-only (no UPDATE / DELETE); a reversal must mirror an un-reversed payment of the same booking (amount, type) and carry an approved request; reversal requests are decided once and never deleted. Applied to both databases after a clean drift check; existing counts unchanged.
- Services (`src/modules/finance`): `recordPayment` (booking row locked; stage check; method active; date not in the future; amount ≤ outstanding computed from rows; idempotency key; audit with paid before / after), `requestReversal`, `decideReversal`, `updateFinanceSettings`, `addPaymentMethod`, `setPaymentMethodActive`; queries for history, list, reversal queue, settings, methods. `ledger.ts` computes net paid from rows (no cached totals).
- Bookings: Paid / outstanding / milestone from the ledger in the list, overview, lead / unit / client mini-lists; cancel blocked while net paid > 0.
- API: `GET/POST /api/v1/finance/payments` (`Idempotency-Key` header), `POST /api/v1/finance/payments/:id/reversal-requests`, `GET /api/v1/finance/reversal-requests`, `POST /api/v1/finance/reversal-requests/:id/decision`, `GET/PUT /api/v1/finance/settings`, `GET/POST /api/v1/finance/payment-methods`, `PATCH /api/v1/finance/payment-methods/:id`, `GET /api/v1/bookings/:id/payments`.
- No Finance screens yet (F2). The sidebar is unchanged.

### 9.3 Verification

| Check | Result |
|---|---|
| Tests | 123/123: unit 22 + 8 + 7 + 7 + 5 + 3; PostgreSQL Leads 18, Clients 11, Projects 7, Inventory 10, Bookings 12, Finance 13 (none skipped) |
| Finance tests cover | receipt numbers; Paid / outstanding / milestone from rows; 30% boundary (3,749,999.99 vs 3,750,000.00 on 12.5M); stage, amount, date, method and role rejections; concurrent over-payment (one wins); concurrent valid payments (distinct numbers); idempotent replay incl. racing replays; trigger blocks UPDATE / DELETE / forged reversal; request → approve / reject; manager team scope; double request; reversal of a reversal; decided request immutable; super-admin emergency audit; cancel blocked then allowed after full reversal; prefixes; method management |
| Live API (dev server, verification accounts) | token posted (receipt 1) and idempotent retry returned the same payment; over-balance rejected with the exact outstanding; two simultaneous 9M payments → one 201, one 400; milestone turned on at ≥ 30%; reversal: agent 403, duplicate 409, accountant cannot decide 403, other team's manager 404, verification manager approved → Paid back to 500,000, history shows reversal 1 of receipt 2, three audit rows; payment in Negotiation 422; cancel with PKR 300,000 received 422 |
| Bookings UI | List, overview and outstanding show the posted figures; cancelled booking shows PKR 0; no overflow at 375 / 768 / 1440 px |
| Server log, typecheck, lint, build | No errors; pass |

Verification data (dev database, labelled VERIFY): account `verify.accountant@mz.local`; payments receipt 1 (token 500,000) and receipt 2 (9,000,000, reversed by reversal 1) on the confirmed VERIFY-A101 booking; a Token-pending booking on VERIFY-B201 with receipt 3 (300,000).

### 9.4 Next

F2 (Finance screens: Payments list, Record payment, payment detail with reverse request, approval queue, Outstanding; booking Payments panel; client payment history; sidebar entry — placement Q-F14) after the client confirms or adjusts §9.1.

## 10. F2 — Finance screens (29 Oct 2026)

Delivered (no schema change; same proposed defaults as §9.1):

- Sidebar: "Finance" under Management after Bookings (placement assumed, Q-F14), shown only to super admin, admin, accountant and manager. Nav items may now carry an optional `roles` list; reference items have none and are unchanged.
- `/dashboard/finance` (Payments: search lead / code / unit / reference / receipt no., project, type, payments vs reversals, date range; Posted / Reversed / Reversal status), `/record` (payable bookings only, live total / paid / outstanding, active methods, one idempotency key per form), `/payments/[id]` (entry, original / reversal links, request history, audit trail, Request reversal or Approve / Reject), `/approvals` (pending queue scoped to the viewer + recently decided), `/outstanding` (per-booking total / paid / outstanding / milestone with reconciling totals), `/settings` (prefixes and methods; editable by super admin only). Tabs are filtered by role; managers land on Approvals. Each route has a `loading.tsx`.
- Booking detail: Payments panel (itemised for finance roles and the team's manager; "Record payment →" when the booking can take one). Client detail: payment history across the client's bookings (FR-204).

Verification:

| Check | Result |
|---|---|
| Tests | 126/126 (Finance PostgreSQL 16: +3 for list filters / reversed flag, detail permissions and scope, outstanding reconciliation and payable bookings) |
| Server-rendered pages per role (real sessions) | accountant: all tabs and entries; manager: redirected to Approvals, only that tab, other team's payment → not found; agent: Access denied, no sidebar entry, booking shows Paid total but no itemised panel; super admin: settings editable |
| Typecheck, lint, build | Pass |
| Browser click-through (window visible) | Accountant: record form showed total / paid / outstanding; 12,000,000 rejected on the field (outstanding 11,700,000); 2,000,000 posted as receipt 4 after a deliberate double-click (one row, idempotency key set); payment detail → Request reversal saved as pending. Manager: /dashboard/finance redirected to Approvals (only tab), approved with a note → reversal 2 posted, queue emptied, history and audit trail updated |
| Layout | 375 / 768 / 1440 px on Payments, Record, payment detail, Approvals, Outstanding, Settings, booking and client pages: no horizontal page overflow. Fixed: at 375 px the record form's Total / Paid / Outstanding tiles truncated amounts ("PKR 16,…"); they now stack in one column on phones |
