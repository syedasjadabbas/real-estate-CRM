# Clients Module — Implementation Notes (Phase 1)

Status: **implemented and verified against PostgreSQL** (29 Oct 2026). **Updated 16 Nov 2026:** a client is now the person behind every lead, manual creation is removed, and the list has more filters. See §8; it replaces older statements below where they differ. Sources: `REQUIREMENTS.md` FR-050–052 · `MODULES_AND_FEATURES.md` §3 · `DATA_MODEL.md` §5 · `USER_ROLES_AND_PERMISSIONS.md` (Clients F/F/T/O/—/R) · `API_DESIGN.md` (Clients).

## 1. Evidence and assumptions

The reference showed the Clients **list only, with 0 records**. During this milestone the reference could not be re-opened (browser extension not connected).

| Item | Basis |
|---|---|
| Subtitle "profiles, investments, contracts, and payment history" | OBSERVED |
| Columns: Client · Contact · Relationship · Latest investment · Next follow-up · Updated | OBSERVED |
| Filters: search; "Has investment in project" | OBSERVED |
| Detail page layout | ASSUMED: same structure as the Lead detail page (facts strip, edit form, side panels, timeline) |
| Relationship values (Prospect / Investor / Repeat investor) | ASSUMED from the draft data model; editable, labelled "pending client confirmation" *(16 Nov 2026: the label is replaced by a plain hint, §8)* |
| Clients are not filtered by the header project selector | ASSUMED: they are long-term profiles across projects |
| Manager scope = clients owned by them or their team members | ASSUMED: same rule as Leads |

## 2. Decisions confirmed by the user (29 Oct 2026)

1. **Creation:** managers (own team's leads) and admins convert a lead to a client; admins can also add one manually. Auto-create on a Confirmed booking is wired in the Bookings milestone. *Superseded: since 13 Nov 2026 every lead joins or creates its person's client, Convert to client is gone from the lead page, and since 15 Nov 2026 there is no manual "Add client" (§8).*
2. **Duplicates:** one client per normalised phone number across all projects. Leads from several projects link to the same client. *13 Nov 2026: matched by any of the person's numbers (§8).*
3. **Investments and payments:** shown as empty states until Bookings exists; "Has investment in project" is shown disabled. **Update 31 Oct 2026:** the detail page shows investments and payment history, and the list now has a working "Has investment in project" filter and a "Latest investment" column (the latest booking that is not cancelled, among bookings the user may see).
4. **Relationship:** editable list, values pending confirmation.

## 3. Data (migration `drizzle/0001_clients.sql`, additive only)

- `clients`: name, phone (country code, national, E.164 with a **unique index**), email, city, relationship (nullable enum), owner, next follow-up (denormalised), last activity, created by, timestamps.
- `leads.client_id` (nullable, `ON DELETE SET NULL`): many leads → one client.
- `client_activities` (history) and `client_follow_ups` mirror the Leads tables; Leads tables are unchanged apart from the new column.
- Every write also goes to `audit_logs` (`entity = 'client'`).
- CNIC and address from the draft model are **not** stored (sensitive / unconfirmed).

## 4. Permissions (server-side, `src/modules/clients/policy.ts`)

| Role | Scope | View | Convert lead | Add manually | Edit, notes, follow-ups | Reassign |
|---|---|---|---|---|---|---|
| Super Admin / Admin | all | ✓ | ✓ | ✓ | ✓ | ✓ |
| Manager | own + team | ✓ | ✓ (team leads) | — | ✓ | ✓ (team) |
| Agent | own | ✓ | — | — | ✓ | — |
| Accountant | all | ✓ (read-only) | — | — | — | — |
| HR | none | — | — | — | — | — |

*16 Nov 2026:* "Add manually" and "Convert lead" are no longer offered anywhere in the app (§8). The Manager role is merged into Admin (13 Nov 2026), so the Manager row only applies to old accounts.

- Out-of-scope clients return **404**. Linked leads on a client page are listed only if the viewer could open them in Leads; the rest are counted, not named.
- A duplicate warning names the existing client only when the actor can see it; otherwise it says the client belongs to another team and asks for an admin to link it. A lead can be linked only to a client the actor can see.

## 5. Screens and API

- `/dashboard/clients` (list), `/dashboard/clients/new` (admins), `/dashboard/clients/[id]` (detail), each with a `loading.tsx`. *`/dashboard/clients/new` and `POST /api/v1/clients` were removed on 15 Nov 2026 (§8).*
- Lead detail gains a **Client** panel: linked client, "Link to existing client" (same phone), or "Convert to client".
- API: `GET/POST /api/v1/clients`, `POST /api/v1/clients/convert`, `GET/PATCH /api/v1/clients/:id`, `POST /api/v1/clients/:id/{assign,notes,follow-ups}`, `POST /api/v1/client-follow-ups/:id/done`. `GET /clients/:id/payments` waits for Bookings.

## 6. Verification (29 Oct 2026)

| Check | Result |
|---|---|
| Migration | Drift check clean; applied to `mz_crm` and `mz_crm_test`; existing leads intact |
| Tests | 59/59: 22 + 8 unit, 18 Leads + 11 Clients PostgreSQL integration (none skipped) |
| Browser | Manager converted a lead → client page; edit, note, follow-up persisted after reload (checked in PostgreSQL with history and audit rows); admin manual add, duplicate phone in another format rejected with a link to the existing client |
| API matrix (9 sessions) | own/team/all scopes; other teams 404; HR 403; signed out 401; cross-origin 403 |
| Layout | No horizontal overflow at 375 / 768 / 1440 px on all Clients routes and the lead page |
| Console / server log | No errors (only the expected dev notice for signed-out requests) |
| Typecheck, lint, build | Pass |

## 7. Open items

- Confirm Relationship values and whether CNIC / address are needed (Q-B7 and data-model ⚠ items).
- Investments, payments, contracts and "Has investment in project" arrive with Bookings (FR-050 auto-create, FR-052, FR-204).
- No client deletion or merge exists yet; the permission matrix does not define them.

## 8. Update, 16 Nov 2026

What Clients does now, after the changes of 13–16 Nov 2026. Where this differs from the sections above, this section wins.

**A client is the person** (13 Nov 2026, migration `0033_client_per_person`)
- Every new lead (added by hand, from the API or an approved import) joins the client who holds any of its phone numbers, or creates one, held by the lead's owner. Existing leads were linked the same way.
- A new inquiry from an existing customer goes to the agent who already handles them while that agent is active.
- The client page shows **Project interests**: one group per project with its inquiries, marked Interested, Lost interest or Booked. Leads the viewer can't open are counted, not listed. The list has an **Interested in** column.
- Convert to client is removed from the lead page; the lead's Client card links to the person's profile. The convert API stays for older callers.

**No manual creation** (15 Nov 2026)
- The "Add client" button, `/dashboard/clients/new` and `POST /api/v1/clients` are removed. Clients come only from leads. (The `createManual` action still exists in `policy.ts` but nothing uses it.)

**List filters** (15 Nov 2026)
- Search plus: interested in project, has investment in project (roles that see bookings), agent (roles that see other agents' clients), city, relationship, booking, follow-up and date added.
- The empty message now takes every filter into account: "No clients match this search or these filters." when anything is applied, otherwise "No clients yet."

**Client form and assignment** (16 Nov 2026)
- The Relationship hint explains the values: "Prospect: hasn't bought yet. Investor: has bought once. Repeat investor: has bought more than once." The values themselves are unchanged and still editable.
- The Assignment panel's owner picker gets a **Find a person** box when there are more than 8 people. The current owner always stays in the list.
