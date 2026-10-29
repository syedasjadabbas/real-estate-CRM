# API Design (PROPOSED)

> This is the planned API for **our** CRM. No reference-CRM endpoints were inspected or reproduced.

## 1. Conventions

- Base path `/api/v1`, JSON over HTTPS. The UI may call the same services through server actions; these REST routes exist for integrations, future mobile apps and tests.
- Auth: an HTTP-only, Secure, SameSite=Lax session cookie. Webhooks use signature headers instead.
- IDs are opaque strings. Timestamps are ISO-8601 UTC. Money is a string decimal (`"25000000.00"`) to avoid float errors.
- Every request is authorised server-side: **permission** (role) + **record scope** (own / team / all) + **project scope**.

### Pagination, sorting, filtering

```
GET /api/v1/leads?page=2&pageSize=50&sort=-createdAt&stage=contacted,qualified_lead
    &source=facebook&priority=high&followUp=overdue&dateField=createdAt&from=2026-10-01&to=2026-10-28&q=0332
```

```json
{ "data": [ ... ], "meta": { "page": 2, "pageSize": 50, "total": 2680, "totalPages": 54 } }
```

### Errors

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Phone is required", "fields": { "phone": "required" } } }
```

| HTTP | code |
|---|---|
| 400 | `VALIDATION_FAILED`, `INVALID_TRANSITION` |
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` (also used when a record is out of the user's scope) |
| 409 | `CONFLICT` (unit already held, duplicate external ID) |
| 422 | `BUSINESS_RULE` (discount above cap, leave overlap) |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL` (no stack traces returned) |

Validation uses shared Zod schemas on client and server. Writes accept an `Idempotency-Key` header (payments, bookings) to prevent double submission.

## 2. Resources

### Auth and session
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | email, password → session cookie; logs sign-in |
| POST | `/auth/logout` | logs sign-out |
| GET | `/auth/me` | user, role, permissions, teams |
| POST | `/auth/password/forgot`, `/auth/password/reset` | optional (email) |

### Dashboard and performance
| GET | `/dashboard/summary?projectId&range=7d&teamId` | KPI tiles, sources, channels, health |
|---|---|---|
| GET | `/dashboard/recent-leads` | |
| GET | `/dashboard/lost-by-reason`, `/dashboard/lost-by-team` | |
| GET | `/performance/agents?from&to&teamId&criticalOnly` | KPI table |
| GET | `/performance/charts?from&to` | outcome mix, call volume, etc. |

### Leads
| Method | Path | Notes |
|---|---|---|
| GET | `/leads` | filters above; `view=all\|won\|lost\|regenerated\|favorites\|duplicates` |
| POST | `/leads` | create (manual); dedupe check; rotation if no owner |
| GET | `/leads/:id` | detail incl. facts |
| PATCH | `/leads/:id` | edit profile fields |
| POST | `/leads/:id/stage` | `{ toStage, reason? }`, validated transition |
| POST | `/leads/:id/assign` | `{ ownerId }` manager / admin |
| POST | `/leads/:id/lost-request` | `{ reasonId, note }` → approval |
| GET / POST | `/leads/:id/activities` | timeline; add note |
| GET / POST | `/leads/:id/follow-ups` | schedule |
| POST | `/follow-ups/:id/done` | |
| POST | `/leads/:id/favorite` / DELETE | |
| POST | `/leads/:id/reviews` | manager |
| POST | `/leads/:id/files` | returns a pre-signed upload URL; then `PATCH /files/:id` to confirm |
| GET | `/leads/todos?bucket=today\|overdue\|...` | To-dos queues |
| GET | `/leads/shared-phones` | groups |
| POST | `/leads/merge` | `{ keepId, mergeIds[] }` manager |
| GET | `/leads/pipeline/board?projectId` | counts + cards per stage |

### Clients
`GET /clients`, `GET /clients/:id`, `PATCH /clients/:id`, `GET /clients/:id/payments`

### Projects and inventory
| Method | Path |
|---|---|
| GET / POST | `/projects` |
| GET / PATCH | `/projects/:id` (incl. `dimensionConfig`) |
| GET | `/units?projectId&status&saleModel&nature&q` |
| POST | `/units`, PATCH `/units/:id` (admin) |
| POST | `/units/import` (CSV → job; returns report ID) |
| GET | `/units/:id` (incl. shares, booking history) |

### Bookings
| Method | Path | Notes |
|---|---|---|
| GET | `/bookings?projectId&stage&q` | |
| POST | `/bookings` | `{ projectId, leadId, unitId, unitShareId?, ratePerSqft, tokenAmount, paymentInstructions }`; locks the unit; 409 if not available |
| GET | `/bookings/:id` | overview + history |
| POST | `/bookings/:id/stage` | `{ toStage, note }` |
| POST | `/bookings/:id/cancel` | `{ reason }`, releases the unit |
| GET | `/bookings/:id/documents/provisional-receipt`, `/sales-order` | print HTML / PDF |

### Tasks and proposals
`GET/POST /tasks`, `GET/PATCH /tasks/:id`, `POST /tasks/:id/installments/rebuild`, `GET /tasks/:id/print`

### Meetings
`GET/POST /meetings`, `PATCH /meetings/:id` (status: completed / cancelled)

### Targets
`GET /targets?period=monthly&periodStart=2026-10-01&teamId`, `PUT /targets` (bulk upsert, manager)

### Teams, daily reports, roster
`GET/POST/PATCH /teams`, `PUT /teams/:id/members`, `GET/PUT /teams/:id/daily-reports/:date`, `GET/PUT /teams/:id/roster?month=2026-11`

### HR and workplace
`GET/POST/PATCH /employees` (HR / admin), `GET/POST/DELETE /holidays`, `GET/POST /leave-requests`, `POST /leave-requests/:id/decision`, `GET /me/workplace` (own leave, holidays, sign-in log)

### Approvals and notifications
`GET /approvals?status=pending`, `POST /approvals/:id/decision` `{ approve: boolean, comment }`
`GET /notifications?unread=1`, `POST /notifications/read-all`

### Settings and admin
`GET/PUT /settings`, `GET/POST/PATCH /users`, `GET/POST/PATCH /lookups/{sources|cities|lost-reasons|finance-categories}`, `GET /audit-logs`

### Accounts & Finance (additional module)
| Method | Path |
|---|---|
| GET / POST | `/finance/payments` (`bookingId` filter) |
| POST | `/finance/payments/:id/reverse` |
| GET / POST | `/finance/income`, `/finance/expenses` (+ `/:id/reverse`) |
| GET | `/finance/balances?projectId&overdueOnly` |
| GET | `/finance/reports/income-expense?from&to&groupBy=month` |
| GET | `/finance/reports/collections?projectId&from&to` |
| GET | `/finance/reports/*.csv` |

### Webhooks (integrations)
| POST | `/webhooks/meta` | Verify `X-Hub-Signature-256`; GET handshake for verification |
|---|---|---|
| POST | `/webhooks/tiktok` | Verify signature / secret; store payload; enqueue |

Webhooks respond `200` quickly and create the lead in a background job (idempotent on `external_id`).

## 3. Rate limits and security

- Login: 5 attempts / 15 min per IP + account, then a temporary lock.
- General API: 300 req / min per user.
- Webhooks: signature required; payload size ≤ 1 MB.
- See `SECURITY_AND_PRIVACY.md`.
