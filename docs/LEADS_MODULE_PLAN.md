# Leads Module — Implementation Plan (Phase 1)

Status: **implemented with the defaults in §9** (approved 28 Oct 2026) and **verified against PostgreSQL** (§10).

## 10. Implementation status (28 Oct 2026)

| Item | State |
|---|---|
| Schema + versioned migration (`drizzle/0000_init.sql`, 18 tables) | Done; applied to `mz_crm` and `mz_crm_test` |
| Auth (Argon2id, DB sessions, idle/absolute expiry, sign-in log, rate limit, login/logout UI and API) | Done |
| Server authorization (role + own/team/all + project scope, 404 for out-of-scope) | Done |
| Leads commands/queries, server actions, `/api/v1` routes | Done |
| Screens: All, To-dos, Shared phones, Pipeline (Kanban/Table), Regenerated, Favorites, Reviews, Won, Lost (+ approvals), Duplicates, Add lead, Lead detail | Done |
| Tests: 22 unit + 18 PostgreSQL integration | **40/40 passing** |
| Browser check with real data (agent, HR) | Passed: create, edit, stage move persist after reload; search; pipeline; HR blocked |
| API access check | agent1/manager/super admin 200 · agent2 404 (view and edit) · HR 403 · no session 401 |

Fixed during verification:
- Lookup tables shared one column object, so the migration named all their unique constraints `lead_sources_name_unique` (migration failed). `lookupColumns` is now a factory; migration regenerated (never applied before).
- `pipelineBoard` selected unaliased SQL fields from a subquery (runtime error). It now ranks ids only and joins back.
- Session expiry now compares against the database clock (`now()`) instead of `new Date()` in the request path, which Cache Components rejected during prefetch.

Instant navigation (29 Oct 2026): every signed-in route now has a `loading.tsx` boundary below the layout it shares with its siblings (`dashboard/loading.tsx`, `dashboard/leads/loading.tsx`, and a one-line re-export in each Leads sub-route), with skeletons in the existing style (`DashboardSkeleton`, `LeadsSkeleton`). Header, sidebar, Leads title and tab bar stay on screen while the page's data streams in. `next dev` reports no instant-navigation insights on any route (checked as agent, manager and HR, including filtered URLs). A new Leads sub-route needs the same one-line `loading.tsx`.

End-to-end verification (29 Oct 2026), against PostgreSQL 18:
- No migration drift (`drizzle-kit check` and `generate` clean; both databases at `0000_init`, hash matches). Seed verified: 5 dev users, Demo Project, Demo Sales Team, 15/13/5/6 lookup rows.
- Test records: four `verify.*@mz.local` accounts (one per role, in `.dev-credentials`) and a second team, "Verification Team (test)", so team scope could be checked across two real teams; leads named `VERIFY …`.
- Browser (sign-in form): agent, manager, super admin, HR, plus wrong password. Covered create → edit → stage → follow-up → note → reload (persisted, with history and audit rows); duplicate warning → log re-inquiry; lost request → manager approval on the Lost tab; search; Kanban/Table; HR "Access denied"; no horizontal overflow at 375/768/1440 px.
- API matrix across 9 sessions: own/team/all/none scopes, 404 out of scope, 403 HR, 401 signed out, 403 cross-origin; managers cannot see, reassign or approve across teams.

Fixed during this pass:
- A partial update that omitted `priority` reset it to "none" (`updateLeadSchema` inherited the create default). Regression test added.
- `GET /api/v1/approvals` returned `200 []` to HR; it now returns 403 like the rest of Leads.
- Kanban board stretched the page to ~2700 px: an `sr-only` label escaped the non-positioned scroller. Scroll containers (`kanban-board`, `leads-table`, `ui/table`) are now `relative`.
- The loading shell said "Not signed in / Sign in / No projects yet" to signed-in users during a hard load; it now shows neutral "Loading…" placeholders.

Commands:

```bash
npm run db:migrate
npm run db:migrate -- --test
npm run db:seed
npm test
```
Sources: `REQUIREMENTS.md` §0, §2 · `MODULES_AND_FEATURES.md` §2 · `DATA_MODEL.md` §2, §4, §8 · `API_DESIGN.md` · `USER_ROLES_AND_PERMISSIONS.md` · `USER_FLOWS.md` §1–3 · `UI_FOUNDATION_NOTES.md`.

## 1. Current state of the codebase

| Area | State |
|---|---|
| UI foundation | Done: shell, tokens, shared components, dashboard (empty states), `/dashboard/leads` placeholder |
| Auth | **Not implemented.** `src/lib/session.ts` returns `null` |
| Database | **None.** No ORM, no migrations, no `DATABASE_URL` |
| Tests | **None.** No test runner |
| Local PostgreSQL | PostgreSQL 18 service running on `localhost:5432`; **password required** (blocker B1) |

## 2. Prerequisites the Leads module cannot work without

Leads are scoped by **user role, team and project**, so this milestone has to add a minimal, real version of:

1. **Authentication**: `users`, `sessions`, `signin_logs` tables; email + password login (Argon2id); HTTP-only session cookie; logout; sign-in/out logging (FR-001, FR-002). No sign-up page: users are created by an admin seed script.
2. **Authorization**: the server-side policy module from `USER_ROLES_AND_PERMISSIONS.md` (role + own/team/all scope + project scope).
3. **Projects and teams tables**: the minimum needed to attach leads and scope managers. No Projects or Teams **screens**; rows come from a seed script. Real Projects and Teams modules stay out of scope.

## 3. Proposed technical choices

| Concern | Choice | Reason |
|---|---|---|
| DB access | **Drizzle ORM + `pg`** | TypeScript-first, plain SQL migrations committed to the repo (versioned, reviewable), no binary engine; works under Next 16 server code |
| Migrations | `drizzle-kit generate` → `drizzle/NNNN_*.sql`, applied by `npm run db:migrate` | Versioned and repeatable |
| Passwords | `@node-rs/argon2` (Argon2id) | Recommended in `SECURITY_AND_PRIVACY.md` |
| Sessions | Random 256-bit token, SHA-256 hash stored in `sessions`, HTTP-only Secure SameSite=Lax cookie, 12 h idle / 7 d absolute | As specified; no third-party auth vendor |
| Validation | `zod` schemas shared by server actions and route handlers | One source of rules |
| Mutations | Server Actions for the UI; `/api/v1/leads…` route handlers for the documented REST API | Both call the same service layer |
| Tests | **Vitest**: unit tests (stage rules, phone normalisation, rotation, permission scopes) + integration tests against a separate `mz_crm_test` database | Real DB behaviour verified |

Code layout (follows `SYSTEM_ARCHITECTURE.md` §4):
`src/server/db/` (client, schema) · `src/modules/{auth,leads,…}/{schema,service,repo,policy}.ts` · `src/app/api/v1/leads/…` · UI in `src/features/leads/`.

## 4. Leads scope for this milestone

| Req | Feature | In this milestone? |
|---|---|---|
| FR-020 | Create lead (name, phone + country code, email, city, source, project, budget, size, priority, gender, note) with 8-char code | ✅ |
| FR-021 | 10 fixed stages; every change logged "from → to" | ✅ |
| FR-022 | All-leads table, reference columns, sort, search (name/email/phone/code), pagination 50 | ✅ |
| FR-023 | Pipeline board (Kanban) + table toggle, stage counts; drag/move with permission check | ✅ move via stage menu **and drag-and-drop** (31 Oct 2026, §12) |
| FR-024 | Filters: stage, follow-up window, source, priority, city, created/updated date range | ✅ |
| FR-025 | Lead detail: facts, timeline, notes, edit sections | ✅ |
| FR-026 | Follow-ups: schedule, mark done, overdue | ✅ |
| FR-027 | To-dos: lead follow-up buckets + unattended 24 h | ✅ (task and meeting buckets added by the Tasks and Meetings modules) |
| FR-028 | Time to first touch | ✅ |
| FR-029 | Auto-assignment by rotation | ✅ (rule per Q2) |
| FR-030 | Manual reassignment (manager/admin) | ✅ |
| FR-031 | Duplicate detection on normalised phone | ✅ (rule per Q1) |
| FR-032 | Shared-phones view | ✅ view only; **merge deferred: rules undefined (§13)** |
| FR-033 | Regenerated (repeat inquiry) | ✅ (rule per Q1) |
| FR-034 | Favorites | ✅ |
| FR-035 | Lost with reason; agent request → manager approval | ✅ |
| FR-036 | Manager reviews feed | ✅ |
| FR-037 | Won view | ✅ |
| FR-042 | Managed city list (no free text) | ✅ |
| FR-038 | Call recording and document uploads | ✅ **call recordings** (§10) and **documents** (§11), 31 Oct 2026 |
| FR-039 | AI call analysis | ❌ out of scope |
| FR-040/041 | Meta / TikTok ingestion | ❌ excluded by instruction |
| FR-043 | CSV import | ❌ later |
| — | "Start booking" button | ✅ live link to `/dashboard/bookings/new` (Bookings module) |

## 5. Database tables (this milestone)

`users`, `sessions`, `signin_logs`, `teams`, `team_members`, `projects`, `lead_sources`, `cities`, `lost_reasons`, `leads`, `lead_activities`, `follow_ups`, `lead_favorites`, `lead_reviews`, `approvals` (lead_lost only), `rotation_state`, `audit_logs`. Columns, enums and indexes as in `DATA_MODEL.md`.

Key constraints:
- `leads.code` unique.
- `(project_id, phone_e164)` indexed.
- Stage enum.
- `follow_ups.due_at` not null.
- One pending lost-approval per lead (partial unique index).
- `lead_favorites` PK `(user_id, lead_id)`.
- Foreign keys use `ON DELETE RESTRICT` for business data.

## 6. Permissions (server-enforced)

| Action | Super Admin / Admin | Manager | Agent | HR / Accountant |
|---|---|---|---|---|
| View / list | all | own teams' leads | own leads | none |
| Create | ✅ | ✅ (owner in team) | ✅ (owner = self or rotation) | ❌ |
| Edit fields, stage, notes, follow-ups | ✅ | team | own | ❌ |
| Reassign | ✅ | team | ❌ | ❌ |
| Mark lost | direct | direct + approve team requests | request only | ❌ |
| Review | ✅ | team | ❌ | ❌ |
| Delete | Super Admin only (soft delete) — **not built**: no delete route or permission (Q-L7 default unconfirmed) | ❌ | ❌ | ❌ |

Out-of-scope records return 404. Every mutation writes `lead_activities` and `audit_logs`.

## 7. API endpoints (this milestone)

`POST /api/v1/auth/login` · `POST /api/v1/auth/logout` · `GET /api/v1/auth/me` ·
`GET|POST /api/v1/leads` · `GET|PATCH /api/v1/leads/:id` · `POST /api/v1/leads/:id/stage` · `POST /api/v1/leads/:id/assign` · `POST /api/v1/leads/:id/lost-request` · `POST /api/v1/leads/:id/notes` (no separate activities route; the timeline is part of `GET /api/v1/leads/:id`) · `GET|POST /api/v1/leads/:id/recordings` · `GET /api/v1/recordings/:id` · `GET|POST /api/v1/leads/:id/follow-ups` · `POST /api/v1/follow-ups/:id/done` · `POST|DELETE /api/v1/leads/:id/favorite` · `POST /api/v1/leads/:id/reviews` · `GET /api/v1/leads/todos` · `GET /api/v1/leads/shared-phones` · `GET /api/v1/leads/pipeline/board` · `GET /api/v1/approvals` · `POST /api/v1/approvals/:id/decision`.

## 8. Screens (matching reference routes)

`/login` (now functional) · `/dashboard/leads` (All) · `/dashboard/leads/new` · `/dashboard/leads/[id]` · `/dashboard/leads/pipeline` · `/dashboard/leads/todos` · `/dashboard/leads/phone-overlap` · `/dashboard/leads/regenerated` · `/dashboard/leads/favorites` · `/dashboard/leads/reviews` · `/dashboard/leads/won` · `/dashboard/leads/lost` · `/dashboard/leads/duplicates`. The sub-tab bar, filter drawer, table columns and detail sections follow `MODULES_AND_FEATURES.md` §2.

Before building each screen I'll re-measure it in the reference (header, tab bar, table, filter drawer, detail page), read-only as before.

## 9. Blocking questions and proposed defaults

| # | Question | Proposed default if you don't specify |
|---|---|---|
| **B1** | **Database access.** I can't connect without the `postgres` password. | You create a dev database and user (SQL below) and put `DATABASE_URL` in `.env.local`. I never need the superuser password. |
| Q1 | Existing phone in same project: duplicate or regenerated? (Q-L1) | Phone matches an **open or lost lead in the same project** → mark that lead **Regenerated** and log the re-inquiry (no new lead). Manual entry with a matching phone → warning, then saved as a **Duplicate** linked to the original if the user confirms. |
| Q2 | Rotation rule (Q-L2) | Round-robin over active agents in **assignable (active) teams**. A lead created by an agent is owned by that agent. Roster/leave skipping waits for HR/Teams. |
| Q3 | Stage transitions (Q-L3) | Any stage can move to any other (as in the reference's "Select target stage"). **Lost** needs a reason and, for agents, approval. **Booked** is reserved for the Bookings module (blocked for now). |
| Q4 | Uploads (FR-038) | Call recordings built on private local storage (§10); the production storage location (server disk or S3-compatible provider) is a deployment decision |
| Q5 | Budget ranges, lost reasons, cities, sources | Seeded editable lists: sources = the 15 reference sources; cities = major Pakistani cities + "Overseas"; budget = Under 10M / 10–20M / 20–30M / 30–50M / 50M+ PKR; lost reasons = Not interested, Budget mismatch, Not responding, Bought elsewhere, Invalid number, Other |

### B1: commands for you (run in pgAdmin or `psql` as `postgres`)

```sql
CREATE ROLE mz_crm LOGIN PASSWORD 'choose-a-dev-password';
CREATE DATABASE mz_crm OWNER mz_crm;
CREATE DATABASE mz_crm_test OWNER mz_crm;
```

Then create `D:\WEBS & APPS\real estate crm\.env.local`:

```text
DATABASE_URL=postgres://mz_crm:choose-a-dev-password@localhost:5432/mz_crm
TEST_DATABASE_URL=postgres://mz_crm:choose-a-dev-password@localhost:5432/mz_crm_test
```

`.env*` is already git-ignored. The seed script will create local dev users with generated passwords printed once to your terminal and stored in an untracked `.dev-credentials` file.

---

## 10. Call recordings and click-to-call (31 Oct 2026)

**Workflow (confirmed):** agents call from company Android phones, record with the phone's built-in recorder where the phone supports it, then upload the file to the lead in the CRM. The CRM does not record calls itself and does not sync with phones.

**Click-to-call:**
- The lead page has a **Call** button and a clickable phone number.
- The phone number in the leads list is clickable too.
- All three are `tel:+<E.164>` links that open the device dialer.
- Nothing is logged when the link is clicked.

**Upload rules** (FR-038; `SECURITY_AND_PRIVACY.md` §6):
- MP3, M4A, AAC, OGG or WAV only, at most 25 MB.
- The server checks the file's first bytes and rejects content that doesn't match its extension: a WAV renamed `.mp3`, HTML, executables or AMR are refused.
- Empty files are rejected.
- The file name is reduced to its base name, with control characters removed, at most 200 characters.
- The request size is checked before the body is read, and requests with no declared size are refused.
- The duration is read by the uploader's browser and stored if it is between 0 and 24 hours; otherwise it is left empty. The server does not decode audio.

**Who may do what** (no new permissions; existing lead rules):

| Action | Super admin | Admin | Manager | Agent | HR | Accountant |
|---|---|---|---|---|---|---|
| Upload | All leads | All leads | Own and team leads | Own leads | — (403) | — (403) |
| List and play | All leads | All leads | Own and team leads | Own leads | — (403) | — (403) |

- Upload follows the note rule: booked leads are read-only (422).
- Leads outside the user's scope return **404**, so their existence is not leaked.
- There is **no delete or replace**, because no deletion permission or retention policy has been confirmed.

**Storage:**
- Files go to a private folder on the server (`FILE_STORAGE_DIR`, default `./storage`, git-ignored, never under `public/`).
- Each file gets a generated key `recordings/YYYY/MM/<uuid>.<ext>`. The key format is validated, so a path cannot escape the folder.
- Files are written under a temporary name, then renamed. If the database insert fails, the file is removed.
- Playback streams from `GET /api/v1/recordings/:id` after the same access check, with:
  - byte-range support so players can seek;
  - `Cache-Control: private, no-store`, `nosniff` and a sandbox CSP;
  - `?download=1` to save the file instead of playing it.

**Database:** additive migration `0011_lead_recordings`. It adds:
- a new `files` table (lead, kind, storage key, original name, type, size, duration, SHA-256, uploader, time) with checks on size, duration and name length;
- a unique storage key and an index on (lead, time);
- a new `file_kind` enum;
- a new timeline value `file_uploaded`.

No existing rows change.

Each upload also:
- adds a timeline entry "Call recording uploaded: <name>";
- writes an audit entry `lead.recording_upload` (with size and SHA-256);
- counts as a touch on the lead (first touch / last activity), like a note.

**Tests:**
- `tests/unit/recordings-rules.test.ts` (8): content detection, file names, duration, byte ranges, storage keys, `tel:` links.
- `tests/integration/recordings.test.ts` (8): storage and metadata; who can and cannot upload; rejected files leave nothing stored; booked and unknown leads; playback access for all six roles; exact bytes and byte ranges; database checks.

**Checked in the browser** (dev server on the test database, so nothing permanent changed):
- The owner agent uploaded a 3-second WAV. Duration 3 s was stored, the type was correct, the timeline entry appeared, and the player loaded (ready state 4).
- Full download returned 200; a byte range returned 206 `bytes 0-3/48044`; an out-of-range request returned 416.
- An HTML file renamed `.mp3` was rejected. An oversized request returned "Recordings can be at most 25 MB".
- Another agent got 404, HR got 403, and the manager could play the recording.
- A database row whose file is missing on disk returns 404 "Recording file not found".
- No horizontal overflow at 375 or 768 px. The Call button's link is `tel:+923001000008`.

**Open points (need the client):**
- Which phone models and formats the recorders produce. Some Android recorders save **AMR / 3GP**, which is outside the documented allow-list and most browsers can't play.
- Whether recordings can be deleted or replaced, and by whom.
- How long recordings are kept.
- Whether an uploaded recording counts as a "call" in Performance and Targets (Calls / Call minutes stay "not available").
- Where production files are stored (server disk with backups, or S3-compatible storage).


---

## 11. Lead documents (31 Oct 2026)

**Rules** (FR-038; `SECURITY_AND_PRIVACY.md` §6):
- PDF, JPG (`.jpg` / `.jpeg`), PNG, DOCX or XLSX, at most 10 MB.
- The server checks the content:
  - PDF must start with `%PDF-`; JPEG and PNG by their signatures;
  - Office files must be an OOXML package containing the Word or Excel main part, so a plain ZIP, an ODT, an `.xlsx` that is really a Word file, HTML or an executable are refused.
- Name cleaning and the size check before the body is read are the same as for recordings.

**Who may do what:** exactly the recording rules (§10). Upload: owner agent, the owner's manager, admins; not on booked leads. Read: anyone who may view the lead. HR and accountants: 403. Out of scope: 404. There is **no delete or replace**.

**Storage:**
- Same private storage as recordings, under `documents/YYYY/MM/<uuid>.<ext>`.
- Served by `GET /api/v1/documents/:id` with `no-store`, `nosniff` and a sandbox CSP.
- Images open inline; PDF and Office files always download.
- A document id cannot be fetched through the recordings route, and the reverse.

**Shared code:** `src/modules/files/lead-files.ts` (upload rule, storage, timeline, audit, touch, access). Recordings were moved onto it unchanged, and all their tests still pass.

**Records:**
- timeline "Document uploaded: <name>";
- audit `lead.document_upload`;
- **no schema change** (the `files.kind` value `document` already existed).

**Tests:** `tests/integration/documents.test.ts` (4):
- content detection;
- the five documented types;
- disguised, wrong, empty and oversized files are rejected with nothing stored;
- access rules, separation from recordings, and booked leads.

**Open questions for the client:**
- Should Office files be allowed to preview in the browser (that would need a viewer)?
- Delete and retention rules for documents.
- Are any other types needed (for example scanned CNIC images in HEIC from iPhones)?

## 12. Pipeline drag-and-drop (31 Oct 2026)

FR-023 ("moving a card changes the stage, with permission").
- **How it works:** cards have a **drag handle**. It uses pointer events, so **mouse, touch and pen** work the same way.
- **Starting a drag:** a press becomes a drag after 6 px of movement.
- **During the drag:**
  - the target column is highlighted (green when the drop is allowed, red for Lost / Booked);
  - a floating label says what will happen;
  - the board auto-scrolls near its edges;
  - Esc or a cancelled touch aborts.
- **The drop** calls the same `changeStageAction` as the existing "Move to…" menu, which stays for keyboard and screen-reader users. Server permissions, stage rules (`assertStageChange`), the timeline and the audit are therefore unchanged.
- **Lost and Booked** cannot be dropped onto, as before. Results are announced to screen readers.

## 13. Shared-phone merge: decisions needed (not built)

FR-032 lists merging leads that share a phone. No document defines the rules, and a merge cannot be undone safely, so it waits on these answers:
1. **Which lead survives?** The oldest, the most advanced stage, or the one chosen by the user? What happens to the other lead (soft-deleted, or marked "merged into …")?
2. **Child records:** do bookings, payments (through bookings), notes and timeline, follow-ups, meetings, tasks / proposals, call recordings, documents, reviews and lost requests move to the surviving lead? What if both leads have a booking, or a pending lost request?
3. **Owners and teams:** which owner keeps the merged lead? Are the other owner and their manager notified? What if the leads are in different projects (merging is per project today)?
4. **Conflicting fields:** name, email, city, source, budget, priority, stage, lost reason, client link, regenerated or duplicate flags, codes. Which value wins: newest, non-empty, or chosen field by field?
5. **Recording and audit:** a merge record (who, when, both codes, before and after values), a timeline entry on the survivor, and whether an undo is required.
6. **Who may merge:** the matrix says super admin, admin and manager (team), but not across teams?
