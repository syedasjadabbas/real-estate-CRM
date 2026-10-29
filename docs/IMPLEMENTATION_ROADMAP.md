# Implementation Roadmap (PROPOSED)

## 0. Honest scope / schedule assessment

| Fact | Value |
|---|---|
| Today | 28 Oct 2026 |
| V1 presentation target | **10 Nov 2026**: 13 calendar days (~9–10 working days) |
| Scope in quotation | 13 reference modules + Accounts & Finance |
| Reference complexity | 10-stage pipeline, rotation, duplicates, 10-stage booking machine with unit holds, proposal builder, roster, daily reports, performance analytics, Meta / TikTok ingestion, AI call analysis |
| Budget | PKR 175,000 one-time, up to 10 users |

**Assessment:** a production-quality build of **every** module, including integrations and Finance, **cannot** be completed and tested by 10 Nov. The plan below makes **10 Nov a working V1 presentation of the core sales workflow** (staging environment, demo data). The remaining modules follow in short phases.

**Decision needed:** what "completion of Version 1" means, because it triggers the second 50% payment (Q-P1). We propose defining it as the end of Phase 7 (handover), with 10 Nov as the presentation milestone.

Excluded unless quoted separately: AI call analysis (FR-039), payroll, tax / bank / gateway integrations, mobile apps, maintenance after handover.

---

## Phase plan

| Phase | Dates (proposed) | Deliverables | Depends on |
|---|---|---|---|
| **P0 Requirements validation** | 29–30 Oct | Client walkthrough with an **admin account** for the unverified screens; answers to the top questions (P1, L1, B1–B3, F1); signed scope list | Client availability |
| **P1 Architecture and DB design** | 30–31 Oct | Final ERD + Prisma schema, repo, CI, staging VPS, `.env.example`, seed data | P0 (partially) |
| **P2 UI foundation and auth** | 31 Oct – 2 Nov | App shell (sidebar, header, project selector), design tokens, DataTable, FilterDrawer, login / logout, sign-in log, users and roles, permission module | P1 |
| **P3 Core CRM** | 2–7 Nov | Projects, Inventory (+ CSV import), Leads (CRUD, pipeline Kanban / table, filters, timeline, notes, follow-ups, To-dos, duplicates, regenerated, rotation), Clients list / detail, Dashboard KPIs | P2 |
| **P4 Sales and booking workflows** | 5–9 Nov | Bookings (new, unit hold + auto-release job, stage machine, overview), Tasks + proposal / payment-plan builder + print, Meetings | P3 |
| **🎯 V1 presentation** | **10 Nov** | Demo on staging: login → lead → follow-up → meeting → proposal → booking → dashboard | P2–P4 |
| **P5 HR, targets, teams, performance** | 11–19 Nov | Targets + achievement, Teams (members, daily report, roster), HR (employees, holidays, leave + approvals), My Workplace, Performance KPIs + charts, Approvals inbox, lost approval, reviews, notifications polish | P3, P4 |
| **P6 Accounts & Finance** | 19–26 Nov | Payments vs bookings, reversals, receipts, balances, income / expense, reports + CSV, printable provisional receipt / sales order | P4, finance answers (F1–F6) |
| **P6b Integrations (if accounts ready)** | parallel 17–26 Nov | Meta lead ads + TikTok webhooks | Client-owned Meta / TikTok business accounts and app approval |
| **P7 Testing, deployment, handover** | 26 Nov – 5 Dec | UAT with client users, bug fixing, data migration from old CRM exports, production deploy, backups, docs, admin training, source code + credentials handover | All |

Dates assume one full-time developer plus reviewer support. They shift one-for-one with client response delays.

---

## Milestone acceptance criteria

| Milestone | Accepted when |
|---|---|
| M0 Scope sign-off (30 Oct) | Signed module and feature list; open questions marked answered or deferred |
| M1 Foundation (2 Nov) | Users of each role can log in and see only their allowed menus; deny screens work |
| M2 Core CRM (7 Nov) | Create / assign / work a lead end to end; duplicates and rotation verified with test data |
| M3 V1 presentation (10 Nov) | Demo script runs without errors on staging |
| M4 Ops modules (19 Nov) | Targets, teams, HR, performance numbers reconcile with test data |
| M5 Finance (26 Nov) | Payments update booking paid and 30% milestone; reports reconcile |
| M6 Go-live and handover (5 Dec) | UAT sign-off, production running with backups, repo and credentials transferred |

## Testing requirements

| Level | What |
|---|---|
| Unit | Stage machines (lead, booking), hold expiry, rotation, discount cap, installment generation, balance computation, leave day count |
| Integration | API + DB: permission scopes per role, unit double-booking prevention (concurrent requests), webhook idempotency |
| E2E (Playwright) | Login per role; lead → booking happy path; lost approval; leave approval; payment recording |
| UAT | Client users run scripted scenarios; sign-off sheet |
| Non-functional | 10k-lead seed: list pages < 1.5 s; backup restore drill; security checklist |

## Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Deadline too tight for full scope | High | Phase plan; define V1 = presentation, completion = handover |
| R2 | Unverified admin screens hide extra features | High | Admin walkthrough in P0; anything new is quoted separately |
| R3 | Meta / TikTok app review and accounts delays | Medium | Client sets up accounts now; CSV import fallback |
| R4 | Booking and SPU business rules unclear | High | Answer Q-B1 to Q-B4 before P4 |
| R5 | Finance expectations grow toward full accounting | Medium | Explicit exclusions in the quotation; basic reports only |
| R6 | Data migration from old CRM unavailable (no export) | Medium | Confirm export ability in P0; manual / CSV templates |
| R7 | No maintenance after handover | Medium | Handover docs, backup automation; offer a separate support quote |
| R8 | Budget vs effort (≈ 6 weeks of work) | High | Keep scope fixed; change requests quoted separately |

## Recommended first phase

**P0 Requirements validation (29–30 Oct).** Book a 60–90 minute session with the client's admin to walk through: Add lead form, project setup, unit detail, booking documents, Teams, HR employees, Approvals, Reports and app settings. Get answers to the "Critical" questions in `ASSUMPTIONS_AND_OPEN_QUESTIONS.md`, and sign the scope list. Development should start only after this.
