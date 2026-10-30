# Admin Walkthrough — Checklist and Question Sheet

**Purpose:** close the gaps that could not be inspected with the Sales Agent account, and get decisions on the questions that affect cost, schedule and data model. Development starts only after this session and scope sign-off.

| | |
|---|---|
| **Duration** | 75–90 minutes (screen share) |
| **Attendees** | Client admin (SaleStorm admin login), client decision-maker (scope and payment), Zeploy Tech lead |
| **Client brings** | Admin access to SaleStorm; a sample provisional receipt, sales order and booking form (PDF or photo); CSV export of leads and units, if available |
| **Rules** | The admin drives the screen. **View only**: nothing is saved, edited or deleted. Blur or skip real customer names and phones when recording. |
| **Output** | Answers filled in below, screenshots with no personal data, signed scope list (§6) |

References: B-xx = blocked screens and Q-xx = open questions, both in `ASSUMPTIONS_AND_OPEN_QUESTIONS.md`.

---

## 1. Agenda

| Time | Topic | Covers |
|---|---|---|
| 0:00–0:10 | Scope and payment terms | Q-P1–Q-P4 |
| 0:10–0:30 | Leads: add form, detail tabs, rules | B-01, B-02, Q-L1–Q-L5 |
| 0:30–0:45 | Projects, inventory, SPU | B-03, B-04, Q-B1 |
| 0:45–1:00 | Bookings, documents, payment plans | B-05, Q-B2–Q-B6 |
| 1:00–1:10 | Teams, HR, approvals, reports, settings | B-06–B-10, B-13, Q-R1–Q-R3, Q-H1–Q-H2 |
| 1:10–1:20 | Finance, integrations, hosting, migration | B-11, B-12, Q-F1–Q-F4, Q-P5–Q-P6, Q-T1, Q-T3 |
| 1:20–1:30 | Recap and sign-off | §6 |

---

## 2. Screens to show (admin drives, view only)

Tick each item once it has been seen and a screenshot taken.

### Leads
- [ ] **Add lead form** (`Leads → Add lead`). Every field, which ones are required, the dropdown lists (source, budget, size, priority, city). *(B-01)*
- [ ] **Lead detail tabs**: Follow-ups, Assets & History, Upload Documents. What is in each? *(B-02)*
- [ ] Lead **reassign** control: where is it, and who can use it?
- [ ] Lost-request flow: where the agent requests it and where the manager approves it. *(B-09)*
- [ ] Merging leads from **Shared phones** / **Duplicates**.

### Projects and inventory
- [ ] **Project detail**: fields, and how inventory dimensions (floors, block, size, category, type, premium) are set up. *(B-03)*
- [ ] **Create / edit project** form.
- [ ] **Unit detail page**: all fields, history, SPU shares. *(B-04)*
- [ ] **Unit import**: CSV template / columns.

### Bookings
- [ ] **Booking detail → Provisional receipt** tab and printout. *(B-05)*
- [ ] **Booking detail → Sales order** tab and printout. *(B-05)*
- [ ] How the booking stage is moved, and what each stage asks for (documents or payments).
- [ ] Where the "Booking form" stage document comes from.

### Teams, HR, admin
- [ ] **Teams** tab: team list, members, team performance. *(B-06)*
- [ ] **HR → Employees**: fields on an employee profile. *(B-07)*
- [ ] **HR → Holidays**: how they are added; regional holidays. *(B-07)*
- [ ] **Leave approval** screen.
- [ ] **Reports** page (`/dashboard/reports`). *(B-08)*
- [ ] **Approvals** inbox. *(B-09)*
- [ ] **App settings**: discount cap, default rate, ROI per sq ft, rotation, any others. *(B-10)*
- [ ] **User and role management**: list of roles, and what each can see. *(B-10)*
- [ ] **Notification list** (bell): types of notifications. *(B-13)*
- [ ] Any **Finance / Payroll** area that exists for admins. *(B-12)*
- [ ] Any menu item an admin sees that an agent does not. **Screenshot the full admin sidebar.**

### Integrations
- [ ] Where Meta / TikTok are connected; who owns those accounts. *(B-11)*

---

## 3. Decisions needed: Critical

Write the answer next to each question during the session.

| ID | Question | Answer |
|---|---|---|
| Q-P1 | Does "completion of Version 1" (second 50% payment) mean the 10 Nov presentation or the final handover? Our proposal: 10 Nov = core demo on staging; completion = handover (~5 Dec). | |
| Q-P2 | Must every module be in V1, or can HR, Teams, Performance and Finance follow in later phases? | |
| Q-P3 | Are Meta and TikTok lead integrations included in PKR 175k? | |
| Q-P4 | Confirm AI call analysis is **excluded** (separate quote, client-paid AI API). | |
| Q-L1 | When a phone number already exists: mark the old lead *Regenerated*, or create a *Duplicate*? Checked per project or across all projects? | |
| Q-B1 | SPU strips and 50% fractional: share size, pricing, can one buyer take several shares, when is a unit "Sold"? | |
| Q-B2 | Token amount → hold duration rule (e.g. PKR __ = __ days). | |
| Q-B3 | Booking stages: which are mandatory, who moves each one, what must be uploaded or paid at each step? | |
| Q-R1 | Roles needed: Super Admin, Admin, Sales Manager / HOD, Sales Agent, HR, Accountant. Add or remove any? | |
| Q-F1 | Should Finance record booking payments (and drive "Paid" on bookings)? | |

## 4. Decisions needed: High

| ID | Question | Answer |
|---|---|---|
| Q-L2 | Lead rotation: equal round-robin? Per team or per project? Skip agents on leave or "leads off"? | |
| Q-L3 | Can agents move a lead backward or skip stages? | |
| Q-L4 | List of lost reasons. Does every lost need manager approval? | |
| Q-L5 | Budget ranges and size options (fixed lists?). | |
| Q-B4 | When does a unit go Reserved → Booked → Sold? | |
| Q-B5 | Receipt and sales order templates: logo, fields, numbering. | |
| Q-B6 | Payment plan defaults: down payment %, installments (36?), ROI per sq ft, default rate, discount cap per role. | |
| Q-R2 | Can a user be in more than one team? Can a manager manage several teams? | |
| Q-R3 | Can agents see unassigned leads or other agents' leads? | |
| Q-H1 | Leave types beyond Annual / CPL? 30 days for everyone? Who approves? | |
| Q-H2 | Is attendance needed, and how should it be recorded? (CRM sign-ins are authentication activity, not attendance.) | |
| C2 | Confirm 12 months of sign-in history retention and approve automatic deletion | |
| C3 | Is there a CDN or load balancer in front of Caddy? | |
| Q-F2 | Who records and approves payments? Is a second person check needed? | |
| Q-F3 | Receipt number format; printed from Finance? | |
| Q-F4 | Income and expense categories. | |
| Q-P5 | Migrate existing data from SaleStorm? Can you export leads, units and bookings to CSV? | |
| Q-P6 | Hosting choice; who owns the domain, server and third-party accounts? | |
| Q-T1 | Agree the proposed stack (Next.js + PostgreSQL on a VPS)? | |
| Q-T3 | Who handles server updates and backup checks after handover (maintenance not included)? | |

## 5. Quick confirmations (Normal)

Answer only if time allows; otherwise we use the default shown.

| ID | Question | Default if not answered |
|---|---|---|
| Q-L6 | City list | Pakistan cities + "Overseas" |
| Q-L7 | Who can delete leads | Super Admin only |
| Q-L8 | "Critical" agent rule | Configurable thresholds, set later |
| Q-B7 | Client created on booking confirmation | Yes |
| Q-R4 | Per-user permission overrides | Not in V1 |
| Q-R5 | 2FA for admin / accountant | Not in V1 |
| Q-R6 | Session timeout | 12 h idle / 7 days max |
| Q-H3 | Daily report entry | Manual |
| Q-H4 | Sold sq ft counted at | Booking confirmation |
| Q-F5 | Currency | PKR only |
| Q-F6 | Payroll | Excluded |
| Q-T2 | Email provider | Client chooses; SMTP |
| Q-U1 | Branding | Client logo + SaleStorm green style |
| Q-U2 | Product name | To be given by client |

---

## 6. Scope sign-off (end of session)

Fill in during the recap, then both sides sign.

| Item | In V1 presentation (10 Nov) | In final handover | Excluded / separate quote |
|---|---|---|---|
| Dashboard, Leads, Projects, Inventory, Clients | | | |
| Bookings, Tasks (proposal / payment plan), Meetings | | | |
| Targets, Teams, HR, My Workplace, Performance | | | |
| Accounts & Finance (additional module) | | | |
| Meta / TikTok lead integration | | | |
| AI call analysis | | | |
| Data migration from SaleStorm | | | |

| | Client | Zeploy Tech |
|---|---|---|
| Name | | |
| Signature | | |
| Date | | |

---

## 7. After the session (Zeploy Tech)

- [ ] Update `MODULES_AND_FEATURES.md` and `REQUIREMENTS.md`: change verified items from INFERRED / UNKNOWN to OBSERVED.
- [ ] Mark answered questions in `ASSUMPTIONS_AND_OPEN_QUESTIONS.md`.
- [ ] Adjust `IMPLEMENTATION_ROADMAP.md` dates to the agreed scope.
- [ ] Quote any new features found in the admin screens separately before starting them.
- [ ] Delete any screenshots that contain customer data.
