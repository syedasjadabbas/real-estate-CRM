# MZ MARKETING — Real Estate CRM

A custom CRM for a real estate sales organisation. It covers the full sales cycle: lead capture and assignment, pipeline management, meetings and follow-ups, bookings, payments and finance reporting. It also covers team performance, HR records and each employee's own workspace.

Every screen and API is permission-checked on the server for the roles Super Admin, Admin, Sales Agent (optionally a team's **Team Lead**), HR and Accountant. Team leaders are Admins; the older Sales Manager role is kept for existing accounts.

> **Status (16 Nov 2026):** every module except Finance has been reviewed page by page as Agent, Admin and Super Admin and is done. **Finance is next.** Not deployed yet. See [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) ("Current status" at the top) for what's done and what's open before going live.

---

## Features

| Area | Highlights |
|---|---|
| **Dashboard** | Live KPIs, date ranges (24h / 7d / 30d / MTD / 6m / custom), team filter, lead sources and channels, pipeline health, lost leads by reason and team |
| **Leads** | List views and filters, Kanban pipeline with drag-and-drop (mouse, touch, pen), timeline, notes, follow-ups, duplicates and re-inquiries, lost-lead approvals, click-to-call, call recordings, documents |
| **Notifications** | Header bell with unread count, follow-up reminder pop-ups, history page, mark read / mark all read |
| **To-dos** | Today's and upcoming follow-ups, overdue leads, tasks and meetings, unattended new leads, personal to-dos; search and agent filter |
| **Clients** | Client records with project interests, investments, payment history, documents and timeline; search and filters |
| **Projects & Inventory** | Projects, units and availability; only the Super Admin edits, Admins read; archive and restore |
| **Bookings** | Token → down payment → Closed Won, linked to leads and units; price from inventory with discount approval above the agent cap; payment proofs and signed forms; stage counts and filters |
| **Accounts & Finance** | Payments and reversals, outstanding balances, collections and outstanding reports, audited CSV export |
| **Meetings & Tasks** | Meetings with outcomes; proposals and payment plans with printouts; clickable counts, team and date filters |
| **Teams & Targets** | Teams with an optional Team Lead, daily report and roster from CRM data, daily / weekly / monthly / custom targets with custom goals |
| **Performance** | Agent KPIs, agent scores, team comparison, pipeline by agent, agent search, CSV exports, and a full work profile per employee with coaching notes |
| **HR & My Workplace** | Employee records (with or without a CRM login), holidays, leave with approvals and balances, attendance check-in / check-out with daily and monthly views, CSV downloads; each person's own check-in, leave and sign-in history |
| **Settings** | Users & access (Super Admin), cities with typed-city adding, assignment rotation and agent scores, security with sign-in history, audit log with plain labels and CSV export, backups status (Super Admin) |
| **Security** | Session auth, login rate limiting, sign-in history, trusted-proxy client IP handling, same-origin protection on API writes, full audit log, nightly backups |

## Tech stack

- **Framework:** Next.js 16 (App Router, Cache Components) · React 19 · TypeScript
- **UI:** Tailwind CSS v4 · lucide-react
- **Data:** PostgreSQL · Drizzle ORM (additive SQL migrations) · Zod v4 validation
- **Files:** private local storage for recordings and documents, served only through authenticated routes
- **Testing:** Vitest (unit and integration) · Playwright (end-to-end, desktop and mobile)

## Getting started

### Prerequisites
- Node.js 24 or later
- PostgreSQL 15 or later, with **two** databases: one for development and one for tests
- Google Chrome (used by the Playwright suite; no browser download is needed)

### Setup

```bash
npm install
cp .env.example .env.local     # then fill in the values below
npm run db:migrate             # apply migrations to the development database
npm run db:migrate -- --test   # apply migrations to the test database
npm run db:seed                # lookup data and local development accounts
npm run dev                    # http://localhost:3000
```

`db:seed` writes the local development account passwords to `.dev-credentials` (git-ignored).

### Environment variables

Set these in `.env.local`, which is git-ignored. `.env.example` lists all of them.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Development / production database |
| `TEST_DATABASE_URL` | Separate test database. It must be a different database whose name contains `test` |
| `TRUST_PROXY`, `TRUSTED_PROXY_COUNT`, `CLIENT_IP_HEADER`, `PROXY_SHARED_SECRET` | Reverse-proxy settings; see [`docs/DEPLOYMENT_PROXY.md`](docs/DEPLOYMENT_PROXY.md) |
| `FILE_STORAGE_DIR` | Private storage for uploads. Defaults to `./storage`; in production, use a persistent volume |
| `BACKUP_DIR`, `BACKUP_REMOTE`, `BACKUP_KEEP_DAILY`, `BACKUP_KEEP_MONTHLY` | Nightly backups: the folder (outside the app and storage folders), the off-site copy destination (set this before going live), and how many daily / monthly backups to keep (defaults 30 and 12). See [`scripts/ops/RESTORE.md`](scripts/ops/RESTORE.md) |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | Route type generation + `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit and integration tests (integration tests use `TEST_DATABASE_URL`) |
| `npm run test:e2e` | Production build + Playwright suite (desktop 1440 px and mobile 375 px) |
| `npm run db:generate` | Generate a SQL migration from `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (add `-- --test` for the test database) |
| `npm run db:seed` | Seed lookups and local development accounts |
| `npm run job:prune-signin-logs` | Sign-in history clean-up. The 12-month period is agreed; deletion stays **off** until it's switched on in Settings → Security. Supports `--dry-run` |

## Testing

- **Vitest** covers business rules (`tests/unit`) and database-backed services and workflows (`tests/integration`) on the test database.
- **Playwright** (`e2e/`) drives the real production build in Chrome against the **test database only**. It covers:
  - authentication and role-based access;
  - lead assignment and notifications;
  - recording and document upload, playback and download;
  - pipeline drag-and-drop (mouse and touch);
  - finance reports and CSV export;
  - dashboard filters and lead-count consistency;
  - responsive layouts.

**Test database safety:**
- A guard refuses to run if the test database is missing, is the same as `DATABASE_URL`, or its name lacks `test`.
- Fixtures are synthetic.
- Teardown empties the test database and the temporary upload folder.

## Project structure

```text
src/
  app/
    (app)/dashboard/     # Authenticated pages, one folder per module
    api/v1/              # JSON API routes (permission-checked, same-origin protected)
    login/               # Sign-in
  components/            # App shell and shared UI components
  features/              # Client components grouped by module
  modules/               # Server-side domain logic: queries, commands, policies, validation
  server/                # Auth, database schema, HTTP helpers, storage, origin checks
drizzle/                 # SQL migrations and snapshots
scripts/                 # Migration, seed and scheduled job scripts
tests/                   # Vitest unit and integration tests
e2e/                     # Playwright end-to-end tests
docs/                    # Requirements, module plans, security, deployment and status
```

## Documentation

| Document | Contents |
|---|---|
| [`PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) | Completed features, verified test results, outstanding client decisions |
| [`REQUIREMENTS.md`](docs/REQUIREMENTS.md), [`MODULES_AND_FEATURES.md`](docs/MODULES_AND_FEATURES.md) | Scope and functional requirements |
| [`USER_ROLES_AND_PERMISSIONS.md`](docs/USER_ROLES_AND_PERMISSIONS.md) | Role matrix |
| [`SYSTEM_ARCHITECTURE.md`](docs/SYSTEM_ARCHITECTURE.md), [`DATA_MODEL.md`](docs/DATA_MODEL.md), [`API_DESIGN.md`](docs/API_DESIGN.md) | Technical design |
| [`SECURITY_AND_PRIVACY.md`](docs/SECURITY_AND_PRIVACY.md), [`FILE_STORAGE_REVIEW.md`](docs/FILE_STORAGE_REVIEW.md) | Security controls and residual risks |
| [`DEPLOYMENT_PROXY.md`](docs/DEPLOYMENT_PROXY.md), [`PRODUCTION_READINESS_PLAN.md`](docs/PRODUCTION_READINESS_PLAN.md), [`PRODUCTION_HANDOVER_CHECKLIST.md`](docs/PRODUCTION_HANDOVER_CHECKLIST.md) | Deployment behind Caddy, environment and storage settings, go-live checklist |
| [`scripts/ops/RESTORE.md`](scripts/ops/RESTORE.md) | Nightly backups, off-site copy and restores |
| `*_MODULE_PLAN.md` | Per-module design and open questions |

## Deployment

The app runs behind a reverse proxy (Caddy 2.5+ recommended) with TLS. The app port must stay private. Before going live, follow:
- the go-live checklist in [`docs/PRODUCTION_HANDOVER_CHECKLIST.md`](docs/PRODUCTION_HANDOVER_CHECKLIST.md) and the open items at the top of [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md);
- the proxy configuration in [`docs/DEPLOYMENT_PROXY.md`](docs/DEPLOYMENT_PROXY.md);
- the backup setup in [`scripts/ops/RESTORE.md`](scripts/ops/RESTORE.md), including the **off-site copy** (`BACKUP_REMOTE`).

Backups cover the database **and** `FILE_STORAGE_DIR` together.

## Development notes

- **Windows:** the parent folder name `WEBS & APPS` contains `&`, which breaks npm's `.cmd` shims, so the npm scripts call `node node_modules/...` directly. Renaming the folder removes the issue.
- **Next.js 16:** this project uses Next.js 16 conventions; see `AGENTS.md` and `node_modules/next/dist/docs/` before changing framework-level code.
- **Design reference:** the UI is based on the SaleStorm reference CRM, rebranded as MZ MARKETING. See [`docs/UI_FOUNDATION_NOTES.md`](docs/UI_FOUNDATION_NOTES.md).
