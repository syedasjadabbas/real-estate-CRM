# Functional Requirements Specification

**Basis** column:
- **REF**: verified in the reference CRM (OBSERVED).
- **REF-I**: inferred from the reference; needs confirmation.
- **NEW**: proposed for our CRM; not in the reference.

**Priority:** **M** = must for V1 · **S** = should for V1 if time allows · **L** = later / separate quote.

> V1 scope is bounded by the quotation (PKR 175,000; up to 10 users; presentation 10 Nov 2026). See `IMPLEMENTATION_ROADMAP.md` for the schedule risk.

---

## 0. Platform and cross-cutting

| ID | Requirement | Basis | Pri | Acceptance criteria |
|---|---|---|---|---|
| FR-001 | Users sign in with email + password; sessions persist until logout or expiry. | REF | M | Valid credentials open the Dashboard; invalid show an error; Log out ends the session. |
| FR-002 | Every sign-in and sign-out is logged with timestamp and IP. | REF | M | Entry appears in My Workplace → sign-in log and counts in Performance. |
| FR-003 | Role-based access: restricted screens show an "Access denied" card, not data. | REF | M | A Sales Agent opening an admin page sees the denial card; the API also returns 403. |
| FR-004 | A global **project selector** scopes leads, inventory, bookings and dashboards. | REF | M | Changing the project updates lists; the choice is remembered per user and device. |
| FR-005 | List pages support search, a filter panel, column sorting and pagination (50 / page). | REF | M | Each filter changes results instantly; "Clear filters" resets them; page navigation works. |
| FR-006 | In-app notifications with an unread count and a pop-up for upcoming follow-ups. | REF | M | A follow-up due within the threshold raises a pop-up and increments the bell. |
| FR-007 | Responsive layout: sidebar collapses to a hamburger below tablet width. | REF | S | Usable at 375 px width without horizontal scroll. |
| FR-008 | All create, update and delete actions on business records are audit-logged. | NEW | M | The audit log stores who, what, when, and before / after for key fields. |
| FR-009 | Admin "App settings": agent discount cap %, default price / sq ft, ROI per sq ft, lead-rotation settings. | REF-I | M | Changing a setting affects new proposals and assignments. |

## 1. Dashboard

| ID | Requirement | Basis | Pri | Acceptance criteria |
|---|---|---|---|---|
| FR-010 | KPI tiles: total leads (open / won / lost %), conversion rate, open pipeline, won / lost, regenerated. | REF | M | Numbers match the leads list for the same scope and range. |
| FR-011 | Date range chips: 24h, 7d, 30d, MTD, 6m, Custom; team filter for managers. | REF | M | Changing the range recalculates all widgets. |
| FR-012 | Lead source and inbound channel breakdown with counts and %. | REF | M | Totals equal the lead count in scope. |
| FR-013 | Pipeline health: stale leads (no update ≥14 days), leads with no meeting in window, meetings done. | REF | S | A lead untouched for 14 days counts as stale. |
| FR-014 | Aging × meetings matrix. | REF | L | Matrix cells equal filtered counts. |
| FR-015 | Recent leads (latest 20) and top projects by lead volume. | REF | M | Clicking a row opens the lead. |
| FR-016 | Lost leads by reason and by team. | REF | S | Clicking a reason opens the filtered lost list. |

## 2. Leads

| ID | Requirement | Basis | Pri | Acceptance criteria |
|---|---|---|---|---|
| FR-020 | Create a lead manually with name, phone (country code), email, city, source, project, budget, size, priority, notes. | REF / REF-I (form not seen) | M | Required: name, phone, source, project. The lead gets a unique 8-character code. |
| FR-021 | Ten fixed pipeline stages (see `MODULES_AND_FEATURES.md` §2.3). | REF | M | A stage change is recorded in the timeline as "from → to". |
| FR-022 | Leads table with the reference columns, sortable. | REF | M | All columns listed in MODULES §2.2 are present. |
| FR-023 | Pipeline Kanban board grouped by stage, with counts; table toggle. | REF | M | Moving a card changes the stage (with permission). |
| FR-024 | Pipeline filters: stage, follow-up window, source, priority, city, date field (created / updated) + range. | REF | M | Filters combine with AND. |
| FR-025 | Lead detail page: facts, timeline, notes, follow-ups, documents and recordings, edit sections. | REF | M | All interactions appear in the timeline, newest first. |
| FR-026 | Schedule a follow-up (date-time + note); mark done; follow-up % metric. | REF | M | Overdue follow-ups show in To-dos → Overdue. |
| FR-027 | To-dos queue: today, done today, tomorrow, 7 / 15 / 30 days, overdue leads / tasks / meetings, unattended 24h+. | REF | M | Each bucket's count matches its list. |
| FR-028 | Time to first touch = first note, file, activity, follow-up, meeting or booking minus created. | REF | S | Shown on the lead and used in reports. |
| FR-029 | Automatic lead assignment by rotation among active agents of an assignable team. | REF | M | New unassigned leads rotate evenly; the timeline shows "Auto-assigned (rotation)". |
| FR-030 | Manual reassignment by manager / admin. | REF-I | M | Reassignment is logged. |
| FR-031 | Duplicate detection on phone (country code + number); flag the duplicate and link it to the original. | REF | M | A new lead with an existing phone is flagged and listed in Duplicates. |
| FR-032 | Shared-phone groups view for non-flagged leads sharing a phone; merge or reassign. | REF | S | A merge keeps a single lead with the combined timeline. |
| FR-033 | Regenerated: a repeat enquiry on an existing lead marks it regenerated (not a new lead). | REF | M | It appears in the Regenerated list, unworked first. |
| FR-034 | Favorites (per-user star) list. | REF | S | A star toggles instantly; the Favorites list shows only own stars. |
| FR-035 | Mark lost with a reason; agent lost requests need manager / admin approval. | REF | M | An agent's lost request stays pending until approved; the reason is stored. |
| FR-036 | Manager reviews on leads, visible to the owning agent (Reviews feed). | REF | S | A review appears in the agent's Reviews view. |
| FR-037 | Won view = leads at stage Booked. | REF | M | — |
| FR-038 | Upload call recordings and documents to a lead (type and size validated). | REF | M | Files are listed on the lead; allowed types only. |
| FR-039 | AI call analysis of recordings (transcript / summary / quality). | REF | L | Separate quote: needs a third-party AI API (client-paid). |
| FR-040 | Meta (Facebook / Instagram) lead ads ingestion → lead with inbound = Meta, external ID stored. | REF | S | A test lead from Meta appears within minutes. |
| FR-041 | TikTok lead-gen ingestion → lead with inbound = TikTok, raw payload kept. | REF | S | Same as FR-040. |
| FR-042 | City chosen from a managed list (with "Other"), validated. | NEW | M | Numbers and phone numbers are not accepted as a city. |
| FR-043 | Lead CSV import (one-time migration from the reference CRM export). | NEW | S | An import report shows created / skipped / duplicate rows. |

## 3. Clients

| ID | Requirement | Basis | Pri | Acceptance criteria |
|---|---|---|---|---|
| FR-050 | A client profile is created from a lead when a booking reaches Confirmed (or manually by admin). | REF-I | M | The confirmed booking's lead appears in Clients, linked. |
| FR-051 | Clients list: client, contact, relationship, latest investment, next follow-up, updated; search; "has investment in project" filter. | REF | M | — |
| FR-052 | Client detail: investments (bookings), contracts / documents, payment history, follow-ups, notes. | REF (subtitle) / REF-I | M | Shows all bookings and payments of the client. |

## 4. Projects

| ID | Requirement | Basis | Pri | Acceptance criteria |
|---|---|---|---|---|
| FR-060 | Create / edit projects: name, type (Building, Farmhouse, Society), developer / company, location, status (active / inactive), description. | REF / REF-I | M | Inactive projects are hidden from the project selector for agents. |
| FR-061 | Per-project inventory dimensions (floors, block, size, category, type, premium) configurable by admin. | REF (text) | S | Dimensions appear as unit fields / filters for that project. |
| FR-062 | Project cards with units tracked and type; link to the inventory. | REF | M | — |

## 5. Inventory

| ID | Requirement | Basis | Pri | Acceptance criteria |
|---|---|---|---|---|
| FR-070 | Units: project, floor, unit no., sale model, area (sq ft), base price, nature, category, type, bedrooms, status, comment. | REF | M | — |
| FR-071 | Statuses: Available, Partially booked, Reserved, Booked, Sold; transitions driven by bookings. | REF | M | Creating a booking sets the unit to Reserved; confirming sets Booked / Sold (rule to confirm). |
| FR-072 | Sale models: Whole unit, SPU strips, 50% fractional. | REF | S | For SPU, booking targets a share; the unit becomes Partially booked until fully sold. |
| FR-073 | Inventory filters: search, project, status, nature, sale model. | REF | M | — |
| FR-074 | Unit detail page with all dimensions and booking history. | REF-I | M | — |
| FR-075 | Bulk unit import from CSV. | REF-I | S | Validation report produced. |

## 6. Bookings

| ID | Requirement | Basis | Pri | Acceptance criteria |
|---|---|---|---|---|
| FR-080 | New booking: project, lead, available unit, per-sq-ft rate, token amount, buyer payment instructions. | REF | M | Only Available (or partially available) units are selectable; the lead moves to Booking in Process. |
| FR-081 | Unit hold: hold duration derived from the token amount; unpaid holds auto-release at expiry. | REF | M | After expiry with no token received, the unit returns to Available and the booking is Cancelled (rule to confirm). |
| FR-082 | Booking stages: Negotiation → Token pending → Token received → Provisional receipt → Sales order → Booking form → Down payment → Agreement pending → Confirmed; Cancelled from any stage. | REF | M | Stage changes are logged; invalid jumps are blocked. |
| FR-083 | Overview: total sale, paid / total, 30% milestone met, reserved until, agreement sent, payment docs status. | REF | M | The 30% milestone turns "Met" when paid ≥ 30% of the total. |
| FR-084 | Generate a printable Provisional receipt and Sales order. | REF (tab names) | S | PDF / print view contains booking, unit, buyer and amount. Layout to be provided by client. |
| FR-085 | Bookings list with search, project and stage filters. | REF | M | — |

## 7. Tasks

| ID | Requirement | Basis | Pri | Acceptance criteria |
|---|---|---|---|---|
| FR-090 | Tasks: title, type (General, Payment plan printable, Proposal), status (Open, In progress, Done, Cancelled), due, assignee, linked lead / booking, description. | REF | M | — |
| FR-091 | Proposal / payment-plan builder: unit pick auto-fills area and price; discount (capped by setting for agents); down payment; N installments (default 36); editable installment rows; printable proposal with fixed sections. | REF | M | Total = area × rate; an agent's discount above the cap is rejected. |
| FR-092 | Overdue tasks appear in To-dos. | REF | M | — |

## 8. Meetings

| ID | Requirement | Basis | Pri | Acceptance criteria |
|---|---|---|---|---|
| FR-100 | Meetings: title, date-time, organizer, linked lead, status (Scheduled, Completed, Cancelled), notes. | REF | M | — |
| FR-101 | Completing a meeting can move the lead to "Meeting Done". | REF-I | S | Prompt or auto-move; rule to confirm. |
| FR-102 | Meetings list with search, status and organizer filters. | REF | M | — |

## 9. Targets

| ID | Requirement | Basis | Pri | Acceptance criteria |
|---|---|---|---|---|
| FR-110 | Managers set per-agent targets for calls, meetings and sold sq ft for daily / weekly / monthly periods. | REF | M | The agent sees own targets; the manager sees the team. |
| FR-111 | Show achievement vs target (% progress). | NEW | S | Achievement is computed from logged calls, meetings and bookings. |

## 10. Teams

| ID | Requirement | Basis | Pri | Acceptance criteria |
|---|---|---|---|---|
| FR-120 | Teams: name, manager, members, active / inactive (inactive = excluded from rotation). | REF | M | — |
| FR-121 | Manager daily report per agent: leads, calls, meetings, tokens, bookings, remarks; admin date-wise review. | REF | S | One report per team per date; editable on the same day. |
| FR-122 | Duty roster: per member per day In office / On site / On leave / Leads off; Day and Month view. | REF | S | Leads-off members are skipped by rotation (INFERRED, to confirm). |

## 11. My Workplace

| ID | Requirement | Basis | Pri | Acceptance criteria |
|---|---|---|---|---|
| FR-130 | My Workplace shows own leave requests, upcoming holidays and sign-in log. | REF | M | — |

## 12. HR

| ID | Requirement | Basis | Pri | Acceptance criteria |
|---|---|---|---|---|
| FR-140 | Employee directory: name, role / designation, department, contact, joining date, status. | REF (card) | M | Admin / HR only. |
| FR-141 | Holiday calendar (company-wide and regional). | REF | M | Holidays appear in My Workplace. |
| FR-142 | Leave: types Annual and CPL; inclusive dates; reason; approval by manager / HR; annual balance (30 days default). | REF | M | Approved leave reduces the balance; overlapping requests are rejected. |
| FR-143 | ~~Attendance: sign-in log based (no biometric).~~ **Superseded 30 Oct 2026:** CRM sign-ins are authentication activity only and are never treated as attendance (no hours, lateness, absences or durations). Attendance is not available until the client approves its rules. | REF-I | M | Q-H2: define attendance (if any) separately. |

## 13. Performance

| ID | Requirement | Basis | Pri | Acceptance criteria |
|---|---|---|---|---|
| FR-150 | Agent KPI table: open leads, booked, lost, win %, calls, call minutes, follow-ups due / done / %, meetings, sign-ins / outs. | REF | M | Matches the underlying records for the range. |
| FR-151 | Charts: outcome mix, top closers, call volume, calls vs meetings. | REF | S | — |
| FR-152 | Call quality buckets (≥30 s verified, ≥60 s qualified) from recording durations. | REF | S | Requires the recording duration to be stored. |
| FR-153 | "Critical" agent flag based on thresholds; "Critical only" filter. | REF (rule UNKNOWN) | S | Thresholds configurable. |

## 14. Accounts & Finance — additional module (NEW)

| ID | Requirement | Basis | Pri | Acceptance criteria |
|---|---|---|---|---|
| FR-200 | Income records CRUD with category, amount, date, method, reference, attachment. | NEW | M | Finance role only. |
| FR-201 | Expense records CRUD with category, payee, amount, date, method, reference, attachment. | NEW | M | — |
| FR-202 | Record booking payments (token, down payment, installment) against a booking. | NEW | M | Booking "Paid" and the 30% milestone update automatically. |
| FR-203 | Outstanding balance per booking = total − received; overdue vs schedule. | NEW | M | Correct after each payment. |
| FR-204 | Payment history per booking and per client with receipt numbers. | NEW | M | — |
| FR-205 | Basic reports: income vs expense by month, collections by project, outstanding by project / agent; CSV export. | NEW | M | Totals reconcile with records. |
| FR-206 | Payments are not hard-deleted; corrections via reversal entries. | NEW | M | The audit trail shows the original and the reversal. |

## Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-01 | Users | Up to 10 concurrent named users |
| NFR-02 | Performance | List pages < 1.5 s at 10k leads |
| NFR-03 | Availability | Business hours; daily backups (client-paid hosting) |
| NFR-04 | Security | See `SECURITY_AND_PRIVACY.md` |
| NFR-05 | Browsers | Latest Chrome, Edge, Safari; mobile Chrome / Safari |
| NFR-06 | Localization | English UI; PKR currency; Asia/Karachi time zone shown; UTC stored |
| NFR-07 | Ownership | Full source code handed over after final payment |
