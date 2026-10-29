# MZ MARKETING — Real Estate CRM

Custom real estate CRM for Zeploy Tech's client. Current stage: **UI foundation** (shell, design tokens, shared components, dashboard layout). Authentication, PostgreSQL and module CRUD come in later stages. See `docs/` for requirements and the roadmap.

## Stack

Next.js 16 (App Router, Cache Components) · React 19 · TypeScript · Tailwind CSS v4 · lucide-react icons · PostgreSQL (planned).

## Commands

```bash
npm install
npm run dev                    # http://localhost:3000
npm run typecheck              # route types + tsc
npm run lint
npm test                       # unit tests; DB integration tests need TEST_DATABASE_URL
npm run build
npm run db:generate            # new SQL migration from src/server/db/schema.ts
npm run db:migrate             # apply migrations (add `-- --test` for the test DB)
npm run db:seed                # lookups + local dev accounts (passwords → .dev-credentials)
```

Environment (`.env.local`, git-ignored): `DATABASE_URL`, `TEST_DATABASE_URL` — see `docs/LEADS_MODULE_PLAN.md` §9.

> **Windows note:** the project folder path contains `&` (`WEBS & APPS`), which breaks npm's `.cmd` shims. The scripts therefore call `node node_modules/...` directly. Renaming the parent folder (e.g. `WEBS-AND-APPS`) removes the issue.

## Structure

```text
src/
  app/
    (app)/layout.tsx            # AppShell (sidebar + header) for signed-in area
    (app)/dashboard/            # Dashboard + one placeholder page per module
    (app)/dev/dashboard-preview # DEV ONLY: dashboard with labelled sample data (404 in production)
    login/                      # Sign-in screen (not connected yet)
    globals.css                 # Design tokens (@theme)
  components/
    shell/                      # AppShell, Sidebar, Header, PageHeader, ModulePlaceholder
    ui/                         # Button, Badge, Card/Panel, Input/Field, Select, Modal, Table,
                                # SegmentedControl, KpiCard/MiniStat, ProgressBar, EmptyState, Skeleton, Avatar
  config/                       # brand.ts, navigation.ts
  features/dashboard/           # Dashboard widgets, view model, dev sample data
  lib/                          # cn, format, session placeholder
```

## Reference fidelity

The UI follows the SaleStorm reference CRM, rebranded as MZ MARKETING. What was measured and what is assumed is listed in `docs/UI_FOUNDATION_NOTES.md`.
