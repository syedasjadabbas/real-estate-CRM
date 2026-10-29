# UI / UX Specification

Measured values come from the reference CRM at a 1440 × 900 viewport (OBSERVED). Hex values converted from the rendered `lab()` / `oklab()` colours are approximate (INFERRED). Everything in §4 onward is **PROPOSED** for the new CRM.

---

## 1. Observed design system

### 1.1 Colour

| Token | Observed value | Use |
|---|---|---|
| Brand green | `#107C41` | Accent text (e.g. "Dashboard" in title), active states |
| Brand gradient | `#107C41 → #0A5D2B` (left → right) | Active sidebar item background |
| Green tint | `#E7F3EC` | Soft badges / highlights |
| Page background | ≈ `#FAFAFA` | Body |
| Surface | `#FFFFFF` | Sidebar, cards, header buttons |
| Text primary | ≈ `#09090B` (zinc-950) | Body text, headings |
| Text secondary | ≈ `#3F3F46` / `#52525B` (zinc-700/600) | Labels, icons |
| Text muted | ≈ `#A1A1AA` (zinc-400) | Placeholders, hints |
| Border | ≈ `#E4E4E7` (zinc-200) at 60–80% opacity | Cards, inputs, dividers |
| Subtle fill | ≈ `#F4F4F5` (zinc-100) | Table header / hover |

Status colours (OBSERVED badges such as RESERVED, AVAILABLE, CANCELLED, CRITICAL, INACTIVE). Their exact hex values were not measured.

### 1.2 Typography (OBSERVED)

- Font: **Geist** (sans), **Geist Mono** for codes and numbers. Fallback: system UI.
- Base size 16 px. Sidebar items 14 px.
- Page hero title: 48 px, weight 900.
- Small uppercase labels with letter spacing for KPI captions ("TOTAL LEADS", "PIPELINE").

### 1.3 Shape and spacing (OBSERVED)

- Cards: radius **24 px**, padding **32 px**, 1 px translucent border, almost no shadow.
- Buttons and nav items: radius **12 px**. Nav item padding 10 × 14 px, bold when active.
- Sidebar **256 px** wide. Header **57 px** high.

### 1.4 Layout patterns (OBSERVED)

- **App shell:** grouped sidebar (section captions in caps), top header with project selector, bell and log out, user card at the sidebar bottom.
- **Page header:** title, one-line description, primary action at the top right (Add lead, New booking, Create task).
- **KPI strip:** 3–4 tiles (value + caption + sub-caption).
- **Data table:** sticky header, ▲▼ sort, row actions, empty state message, pagination footer with a page number input.
- **Filters:** right-side drawer titled "<Module> filters", "Changes apply immediately", Clear filters and Done buttons. Dropdowns are listboxes with ✓ multi-select.
- **Detail page:** back link, summary facts grid, tab bar, timeline cards.
- **Restricted card:** "RESTRICTED / Access denied / Ask an admin".
- **Toasts:** bottom-left follow-up reminders with VIEW / ALL actions.
- **Kanban:** stage columns with counts.

### 1.5 Responsive behaviour (OBSERVED)

Below ~800 px the sidebar is hidden behind a hamburger button. The header compacts to avatar, project selector, bell and log out. Tables become horizontally scrollable.

### 1.6 Accessibility observations

- Dropdowns use `aria-haspopup="listbox"` and `role=option`: good.
- The colour-only stage and status badges need text labels, which they have.
- Some muted grey text on white may fall below 4.5:1 contrast: **check** in the new build.
- Sort arrows rendered as text characters (▲▼) are not announced as sort state. PROPOSED: use `aria-sort`.

---

## 2. Proposed design tokens (new CRM)

We keep the same visual language (green brand, zinc neutrals, rounded cards) so users of the old system feel at home. The brand colour should be confirmed with the client (Q-U1).

```text
--color-brand-600: #107C41   --color-brand-700: #0A5D2B   --color-brand-50: #E7F3EC
--color-bg: #FAFAFA          --color-surface: #FFFFFF
--color-text: #09090B        --color-text-2: #3F3F46     --color-muted: #71717A
--color-border: #E4E4E7
--status-success: #16A34A    --status-warning: #D97706   --status-danger: #DC2626
--status-info: #2563EB       --status-neutral: #71717A
--radius-card: 20px  --radius-control: 10px  --radius-pill: 999px
--space: 4px scale (4/8/12/16/24/32)
--font-sans: Geist, system-ui   --font-mono: Geist Mono
--sidebar-w: 256px  --header-h: 56px
```

Status badge mapping (PROPOSED):

| Domain | Values → colour |
|---|---|
| Lead stage | New / Attempted = neutral; Contacted / Qualified = info; Meeting = brand; Booking in process = warning; Booked = success; Lost = danger; Future = neutral-outline |
| Unit | Available = success; Partially booked = warning; Reserved = info; Booked / Sold = neutral-dark |
| Booking | Pre-token = neutral; Token / receipts = info; Down payment / agreement = warning; Confirmed = success; Cancelled = danger |
| Task / meeting | Open / Scheduled = info; In progress = warning; Done / Completed = success; Cancelled = danger |

---

## 3. Reusable components (PROPOSED)

| Component | Notes |
|---|---|
| AppShell (Sidebar, Header, ProjectSelector, NotificationBell, UserMenu) | Role-aware menu |
| PageHeader | Title, description, actions |
| KpiTile, KpiStrip | Value, caption, trend |
| DataTable | Server-side sort, filter and pagination; column visibility; empty / loading / error states; `aria-sort` |
| FilterDrawer | Schema-driven filters (select, multiselect, date range, search) synced to URL query |
| StatusBadge | Domain → colour map |
| Timeline | Event cards by type (note, stage, follow-up, file, assignment, meeting, booking) |
| FormField set | Text, phone (country code), money (PKR), area (sq ft), date-time, select, file upload |
| Kanban | Columns by stage, drag to move (permission-checked) |
| Tabs, Modal, ConfirmDialog, Toast | — |
| RestrictedCard | Access denied |
| PrintLayout | Proposal, provisional receipt, sales order (A4) |
| Charts | Bar / donut / line (lightweight chart library) |

---

## 4. Proposed screen list (V1)

| # | Screen | Key elements |
|---|---|---|
| S-01 | Login | Email, password, error state |
| S-02 | Dashboard | KPI strip, range chips, sources, channels, recent leads, lost by reason |
| S-03 | Leads: All | Table, filters, Add lead |
| S-04 | Leads: Pipeline | Kanban / table toggle, stage counts |
| S-05 | Leads: To-dos | Bucket chips + list |
| S-06 | Leads: Regenerated / Duplicates / Shared phones / Favorites / Won / Lost / Reviews | Table variants |
| S-07 | Lead create / edit | Form sections: Contact, Profile, Interest, Location |
| S-08 | Lead detail | Facts, booking card, tabs (Profile, Follow-ups, Files, Timeline) |
| S-09 | Clients list / detail | Investments, payments, documents |
| S-10 | Projects list / form / detail | Cards; dimensions config |
| S-11 | Inventory list / unit detail / import | Filters; unit history |
| S-12 | Bookings list / new / detail | Stage stepper, overview, documents |
| S-13 | Tasks list / create (proposal builder) / print | Installment editor |
| S-14 | Meetings list / form | — |
| S-15 | Targets | Period switch, agent grid, progress |
| S-16 | Teams: Teams / Daily report / Duty roster | — |
| S-17 | My Workplace | Leave, holidays, sign-in log |
| S-18 | HR: Employees / Holidays / Leave | — |
| S-19 | Performance | KPIs, charts, agent table |
| S-20 | Approvals inbox | Lost requests, leave, discount above cap |
| S-21 | Finance: Income / Expenses / Payments / Outstanding / Reports | Additional module |
| S-22 | Settings: Users, Teams, Sources, Cities, Lost reasons, App settings, Audit log | Admin |

Responsive: all screens usable at 375 px. Kanban scrolls horizontally on mobile; tables switch to card rows below 640 px (PROPOSED).
