# Assumptions and Open Questions

Priority: **Critical** = affects architecture, data model, cost or timeline · **High** = affects a module's design · **Normal** = can be decided during build.

---

## 1. Blocked / unverified inspections

| # | Screen / function | Why blocked | Needed from client |
|---|---|---|---|
| B-01 | Add lead form | "Checking access…" never resolved | Admin walkthrough or screenshot |
| B-02 | Lead detail tabs: Follow-ups, Assets & History, Upload Documents | Contents not loaded | Walkthrough |
| B-03 | Project detail / dimension setup | Access denied | Walkthrough |
| B-04 | Unit detail page | Data did not load | Walkthrough |
| B-05 | Booking Provisional receipt / Sales order | Not loaded | Sample printed documents |
| B-06 | Teams list / members / team performance | Access denied | Walkthrough |
| B-07 | HR Employees, Holidays | Access denied | Walkthrough |
| B-08 | Reports page | Never loaded | Walkthrough |
| B-09 | Approvals inbox | Not in agent menu | Walkthrough |
| B-10 | App / admin settings, user and role management | No access | Walkthrough |
| B-11 | Meta / TikTok configuration | Not visible | Account owner info |
| B-12 | Finance / payroll area (if any) | Not visible | Confirm it exists or not |
| B-13 | Notification list contents | Not opened | Confirm notification types |

---

## 2. Open questions (prioritised)

### Project and scope

| ID | Priority | Question |
|---|---|---|
| Q-P1 | **Critical** | What exactly counts as "completion of Version 1" for the second payment: the 10 Nov presentation or the final handover? |
| Q-P2 | **Critical** | Is the full module list mandatory for V1, or can HR, Teams, Performance and Finance follow in later phases (see roadmap)? |
| Q-P3 | **Critical** | Are Meta and TikTok lead integrations in the PKR 175k scope? (They appear in the reference but not as named items in the quotation.) |
| Q-P4 | **Critical** | AI call analysis: confirm it is **out of scope** (separate quote + client-paid AI API). |
| Q-P5 | High | Should we migrate existing data (≈2.7k leads, units, bookings) from SaleStorm? Can the client export CSVs? |
| Q-P6 | High | Hosting: VPS (recommended) or managed cloud? Who owns the domain and accounts? |

### Leads

| ID | Priority | Question |
|---|---|---|
| Q-L1 | **Critical** | Exact rule when a phone already exists: mark the existing lead *Regenerated*, or create a *Duplicate* linked to it? Is the scope per project or across all projects? |
| Q-L2 | High | Rotation rules: equal round-robin? Per team or per project? Skip agents on leave / leads-off? Working hours only? |
| Q-L3 | High | Allowed stage transitions: can agents move backwards or skip stages? |
| Q-L4 | High | Lost reasons list, and does every lost need manager approval? |
| Q-L5 | High | Budget range list and "size" options (fixed lists?). |
| Q-L6 | Normal | City list: Pakistan cities + "Overseas (country)"? |
| Q-L7 | Normal | Who can delete leads, if anyone? |
| Q-L8 | Normal | How is "Critical" agent status calculated (thresholds)? |

### Inventory and bookings

| ID | Priority | Question |
|---|---|---|
| Q-B1 | **Critical** | SPU strips and 50% fractional: how are shares sized, priced and booked? Can one buyer take several shares? When is the unit "Sold"? |
| Q-B2 | **Critical** | Token amount → hold duration formula (e.g. PKR X = N days). |
| Q-B3 | **Critical** | Which booking stages are mandatory, who moves each stage, and what documents or payments gate each one? |
| Q-B4 | High | When does a unit move Reserved → Booked → Sold? |
| Q-B5 | High | Provisional receipt and Sales order templates (logos, fields, numbering). |
| Q-B6 | High | Payment plan defaults: down payment %, installment count (36?), ROI per sq ft, default rate, discount caps per role. |
| Q-B7 | Normal | Is a client record created automatically on confirmation? |

### Roles and permissions

| ID | Priority | Question |
|---|---|---|
| Q-R1 | **Critical** | Confirm the role list: Super Admin, Admin, Sales Manager / HOD, Sales Agent, HR, Accountant. |
| Q-R2 | High | Can a user belong to several teams? Can a manager manage several teams? |
| Q-R3 | High | Should agents see unassigned or other agents' leads? |
| Q-R4 | Normal | Is per-user permission override needed? (Not in V1 as proposed.) |
| Q-R5 | Normal | 2FA for admin / accountant? |
| Q-R6 | Normal | Session timeout preferences. |

### HR, teams, targets

| ID | Priority | Question |
|---|---|---|
| Q-H1 | High | Leave types beyond Annual and CPL? Is the 30-day quota the same for all? Who approves (manager, HR or both)? |
| Q-H2 | High | Attendance: CRM sign-ins are **not** attendance (decided 30 Oct 2026, C1). Does the client need attendance at all, and if so how is it recorded (clock-in / clock-out, roster, other)? |
| Q-H3 | Normal | Daily report: manual entry only, or pre-filled from system data? |
| Q-H4 | Normal | Targets: is the "sold sq ft" achievement counted at booking creation or at confirmation? |

### Accounts & Finance (additional module)

| ID | Priority | Question |
|---|---|---|
| Q-F1 | **Critical** | Does Finance own booking payments (replacing "Paid" on bookings)? |
| Q-F2 | High | Who records and approves payments? Is maker-checker needed? |
| Q-F3 | High | Receipt number format; is the receipt printed from Finance? |
| Q-F4 | High | Income and expense category lists. |
| Q-F5 | Normal | Multi-currency for overseas buyers? (Proposed: PKR only.) |
| Q-F6 | Normal | Payroll: confirm **excluded**. |

### Technical / UI

| ID | Priority | Question |
|---|---|---|
| Q-T1 | High | Is the recommended stack (Next.js + PostgreSQL on a VPS) acceptable to the client and whoever maintains it later? |
| Q-T2 | Normal | Email provider for password reset and approvals (client-paid)? |
| Q-T3 | High | Who handles server updates and backup monitoring after handover (maintenance excluded)? |
| Q-U1 | Normal | Keep the green brand from SaleStorm, or use the client's own brand / logo? |
| Q-U2 | Normal | Product name for the new CRM. |

---

## 3. Working assumptions (until answered)

| ID | Assumption | Label |
|---|---|---|
| A-01 | Single company (single tenant); multiple projects. | PROPOSED |
| A-02 | Up to 10 named users; English UI; PKR; Asia/Karachi time zone. | PROPOSED |
| A-03 | Pipeline and booking stages are the same as in the reference CRM. | OBSERVED → reused |
| A-04 | A client record is created when a booking is confirmed. | INFERRED |
| A-05 | Agents see only their own leads; managers see their team's; admins see all. | INFERRED |
| A-06 | Meta / TikTok integrations are built only if client accounts are ready; otherwise CSV import. | PROPOSED |
| A-07 | AI call analysis is excluded from the PKR 175k scope. | PROPOSED |
| A-08 | Accounts & Finance is basic (no double-entry ledger, tax, bank or gateway). | PROPOSED (per quotation) |
| A-09 | Payroll is excluded. | PROPOSED |
| A-10 | Hosting, domain, storage, email and API costs are paid by the client. | Quotation |
| A-11 | The 10 Nov milestone is a presentation of core workflows on staging. | PROPOSED |
| A-12 | Duty roster "Leads off" excludes an agent from rotation that day. | INFERRED |

---

## 4. Proposed features (not in the reference CRM)

| Feature | Reason |
|---|---|
| Accounts & Finance module | Client request (additional module) |
| Managed city list | Fix observed free-text data quality |
| Target achievement % view | Reference shows targets only |
| Audit log | Accountability for bookings and finance |
| Approvals inbox (unified) | Reference mentions approvals; unify lost, leave and discount approvals |
| Lead CSV import | Migration from the reference CRM |
