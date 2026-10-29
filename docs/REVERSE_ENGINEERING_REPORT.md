# Reverse Engineering Report — SaleStorm CRM (Reference)

> Project: Custom Real Estate CRM for Zeploy Tech's client
> Reference system: SaleStorm CRM (`salestorm.sereneheightsnathiagali.com`)
> Inspection date: 28 October 2026
> Status: Documentation and planning only. No development has started.

## Evidence labels used in all documents

| Label | Meaning |
|---|---|
| **OBSERVED** | Directly visible in the reference CRM (page noted in brackets). |
| **INFERRED** | Reasonable interpretation of what was seen; needs confirmation. |
| **PROPOSED** | A design decision for the new CRM. |
| **UNKNOWN** | Could not be verified through the available interface. |

---

## 1. Methodology

1. **Read-only browsing.** The reference CRM was inspected in a browser session that was already signed in. Only navigation, reading page text, opening filter panels and opening dropdowns (closed again without selecting) were performed.
2. **No state changes.** No record was created, edited, deleted, submitted, uploaded, exported or approved. No settings, filters or sessions were changed. The browser was left on the Dashboard.
3. **No endpoint or source inspection.** Network requests, APIs and source code were not inspected. Everything here comes from the rendered interface.
4. **Two passes.**
   - Pass 1 (earlier on 28 Oct): every sidebar module, with page text, headings, table columns and form fields.
   - Pass 2: lead sub-views, filter option lists, HR sub-pages, Teams tabs, layout dimensions, typography and colours.
5. **Privacy.** No customer names, phone numbers, emails or other personal data were copied into these documents. Counts are given only where they help size the system.

### Inspection account

- **OBSERVED** [Dashboard header badge]: the session belongs to a user with the role badge **"Sales Agent"**.
- Many admin and manager screens therefore showed **"Access denied"** or never loaded. These are listed in §6.

### Reliability note

During pass 2 the reference site became slow. Several pages stayed on "Checking access…" or showed loading placeholders for a long time. Pages opened by typing their URL hung more often than pages opened through in-app links. Some screens seen in pass 1 (lead detail, booking detail) could not be re-opened in pass 2.

---

## 2. Observed Application Structure

### 2.1 Global layout (OBSERVED, desktop 1440 px)

- **Left sidebar** (256 px wide, white). Product name "SALESTORM CRM", workspace name and a search box. Grouped navigation:

  | Group | Items |
  |---|---|
  | DASHBOARD | Dashboard |
  | CLIENTS & LEADS | Leads, Clients |
  | PROJECTS & INVENTORY | Projects, Inventory |
  | STAFF | My workplace, HR |
  | MANAGEMENT | Targets, Teams, Bookings, Tasks, Meetings |
  | REPORTS | Performance |

  At the bottom: a user card (avatar initials, name, email) and the label "Workspace: SaleStorm".
- **Top header** (57 px). Sidebar toggle, current user chip, a **global PROJECT selector**, a notification bell with an unread count ("99+") and a Log out button.
- **Main area.** Page title and description, KPI tiles, then a filterable and sortable table or card list with pagination.
- **Narrow screens (OBSERVED at ~400–800 px).** The sidebar collapses behind a hamburger button. The header keeps the project selector, the bell and log out.

### 2.2 Global project scope

- **OBSERVED** [Header]: a "PROJECT" dropdown (for example "Serene Heights T2") scopes most lists, including leads, inventory and bookings.
- **INFERRED**: the selected project is remembered in the browser between visits.

### 2.3 Modules found

| # | Module | Route | Accessible as Sales Agent |
|---|---|---|---|
| 1 | Dashboard | `/dashboard` | Yes |
| 2 | Leads (10 sub-views) | `/dashboard/leads/*` | Yes; Add Lead page did not load |
| 3 | Clients | `/dashboard/clients` | Yes (list only, 0 records) |
| 4 | Projects | `/dashboard/projects` | List yes; detail **Access denied** |
| 5 | Inventory | `/dashboard/inventory` | Yes (list) |
| 6 | Bookings | `/dashboard/bookings` | Yes (list, new-booking form, overview tab) |
| 7 | Tasks | `/dashboard/tasks` | Yes (list + create form) |
| 8 | Meetings | `/dashboard/meetings` | Yes (list, 0 records) |
| 9 | Targets | `/dashboard/targets` | Yes (own targets) |
| 10 | Teams | `/dashboard/teams` | Tabs visible; Teams tab **Access denied** |
| 11 | My Workplace | `/dashboard/workspace` | Yes |
| 12 | HR | `/dashboard/hr` | Overview + Leave yes; Employees, Holidays **Access denied** |
| 13 | Performance | `/dashboard/performance` | Yes |
| — | Reports | `/dashboard/reports` | Linked from the dashboard; never loaded (UNKNOWN) |
| — | Approvals | not in menu | Mentioned on the Lost leads page (UNKNOWN) |
| — | Accounts & Finance | not present | **Not in the reference CRM.** Proposed extension only. |

---

## 3. Important Findings

1. **The pipeline is the core.** Leads move through 10 fixed stages: New Lead → Contact Attempted → Contacted → Qualified Lead → Meeting Scheduled → Meeting Done → Booking in Process → Booked, plus Lost Lead and Future Opportunity. OBSERVED [Pipeline board, filter list]
2. **Lead intake is multi-channel.** Inbound channels are Manual, Meta and TikTok. There are 15 lead sources, including WhatsApp, Facebook, Google, Walk in, Reference, Dealers, Old CRM (Meta) and CEO data. TikTok leads store the raw lead-form payload. OBSERVED [Dashboard, Pipeline filters, Pipeline table]
3. **Lead quality controls.** The system flags duplicate leads, groups leads that share a phone number ("Shared phones") and tracks leads that enquire again ("Regenerated"). OBSERVED [Leads sub-views]
4. **Automatic assignment.** The lead timeline shows "Auto-assigned (rotation)". OBSERVED [Lead detail timeline]
5. **Follow-up discipline is central.** There is a To-dos queue (today, tomorrow, 7/15/30 days, overdue leads, tasks and meetings, unattended 24h+). The system measures time to first touch, flags stale pipeline (no update in 14 days) and computes follow-up %. OBSERVED
6. **AI call analysis.** Agents upload call recordings to a lead, and an "AI worker" analyses them. During inspection it showed "The AI worker is offline". OBSERVED [Lead detail]
7. **Inventory supports fractional sales.** Sale models are Whole unit, SPU strips and 50% fractional. Unit statuses are Available, Partially booked, Reserved, Booked and Sold. OBSERVED [Inventory filters]
8. **Bookings are a detailed state machine.** The stages are Negotiation, Token pending, Token received, Provisional receipt, Sales order, Booking form, Down payment, Agreement pending, Confirmed and Cancelled. The token amount decides how long a unit is held, and unpaid holds are released automatically. OBSERVED [Booking filters, New booking page]
9. **Payment plans live in Tasks.** "Payment plan creation has moved to Tasks." Tasks of type *Proposal* or *Payment plan printable* produce a printable investment proposal with a discount, a down payment and an installment schedule (default 36). Agents can discount up to 5%, set in "app settings". OBSERVED [Booking overview, Task create form]
10. **Management tooling.** There are manager daily reports (leads, calls, meetings, tokens, bookings, remarks per agent), a duty roster (in office, on site, on leave, leads off), manager reviews on leads and an approval step for lost requests. OBSERVED [Teams tabs, Reviews, Lost leads]
11. **Performance analytics.** Per-agent KPIs cover leads, bookings, win %, calls and call minutes (from recordings), follow-up %, meetings and CRM sign-ins and sign-outs, with a "Critical" flag. OBSERVED [Performance]
12. **Data quality issue.** The City field is free text. The city filter lists hundreds of messy values, such as phone numbers typed into the city field. The new CRM should validate this field. OBSERVED [Pipeline filters → City]
13. **No finance module.** No income, expense or ledger screens exist for this role. HR mentions "Payroll is managed under Finance", which suggests a finance area might exist for admins. UNKNOWN

---

## 4. Approximate Data Volumes (OBSERVED, for sizing)

| Item | Approx. value | Source |
|---|---|---|
| Leads in active project | ~2,700 | Dashboard / Pipeline |
| Projects | 4 (2 inactive) | Projects |
| Units tracked | ~135 in one project | Projects |
| Lead sources in use | 9 of 15 | Dashboard |
| Call recordings (one agent, range) | ~600+ | Performance |

These volumes are small. A single database server will handle them comfortably for years.

---

## 5. Observed Technology Hints (INFERRED only)

- The UI uses the **Geist** font and a utility-class styling approach with a zinc-grey palette. This is typical of Next.js and Tailwind projects, but **not verified**.
- Record IDs look like collision-resistant IDs (for example `cm…`), which is common with some ORMs. **Not verified.**
- None of this decides the new system's architecture. See `SYSTEM_ARCHITECTURE.md`.

---

## 6. Limitations and Unverified Areas

| Screen / function | Reason |
|---|---|
| Add lead form (`/leads/new`) | Stuck on "Checking access…" |
| Lead detail tabs (Follow-ups, Assets & History, Upload Documents) | Seen in pass 1 only as tab names; contents not read |
| Project detail / inventory dimension setup | Access denied (Sales Agent) |
| Inventory unit detail page | Data did not load in pass 2 |
| Booking detail tabs: Provisional receipt, Sales order | Tab names seen; contents not loaded |
| Teams list, members, team performance | Access denied |
| HR Employees, Holidays | Access denied |
| Reports (`/dashboard/reports`) | Never loaded |
| Approvals (lost requests) | Mentioned in text only; no menu entry for this role |
| Admin / app settings (discount cap, ROI per sq ft, default price) | Referenced in text; no access |
| User management, roles, permissions screens | Not visible to this role |
| Notification centre | Bell and pop-up alerts seen; the list was not opened |
| Meta / TikTok integration configuration | Only the results (inbound channel, payload) were seen |
| Finance / Payroll | Not visible; HR text references it |

**Recommendation:** before finalising scope, get **one admin-level walkthrough** (screen share or admin credentials used by the client) covering the items above. See `ASSUMPTIONS_AND_OPEN_QUESTIONS.md`.

---

## 7. Confirmation of No Changes

- No data was created, modified, deleted, submitted or uploaded in the reference CRM.
- Filter panels and dropdowns were opened only to read their options, then closed without choosing anything. All filters still showed "Any" afterwards.
- The session stayed signed in, and the browser was returned to the Dashboard.
