# Version 1 execution plan: development, production deployment and client handover

Revised **Tuesday 3 November 2026**. **Plan only: nothing is implemented until Zeploy Tech gives explicit approval.**

**What changed in this revision.**
- There is **no demo or presentation environment**. The deliverable is the CRM **deployed on the client's own server**.
- The quotation's "Version 1 presentation, 10 November 2026" is the handover target for that deployed system.
- Removed: the demo database, fictional presentation data, demo seeding and demo configuration.
- Added: production deployment preparation, client acceptance, and external integrations kept separate.

Companion documents:
- `PRODUCTION_HANDOVER_CHECKLIST.md`: step-by-step deployment and handover checks.
- `EXTERNAL_INTEGRATIONS.md`: Meta and other integrations, excluded from this delivery.
- `CLIENT_ANSWERS_RECONCILIATION.md`, `POST_QUESTIONNAIRE_IMPLEMENTATION_PLAN.md`, `CHANGE_REQUESTS.md`, `REMAINING_CLIENT_CLARIFICATIONS.md`.

---

## 1. Delivery process

| Step | Activity | Owner | Depends on |
|---|---|---|---|
| 1 | Complete CRM development (E1–E3; E4 / E5 when signed) | Zeploy Tech | Approval of this plan |
| 2 | Prepare the application for production: setup script, backup and restore scripts, runbook, handover documents | Zeploy Tech | — |
| 3 | Configure the client's server, database, domain and environment | Zeploy Tech, with client access | **Client-provided hosting, domain and access (§6)** |
| 4 | Deploy the CRM to the client's server | Zeploy Tech | Step 3 |
| 5 | Create the client's initial accounts and configure roles, teams and lookup lists | Zeploy Tech (first Super Admin), client's Super Admin (other users) | Client's user and lookup lists |
| 6 | Hand over the product: handover session and documents | Zeploy Tech | Step 5 |
| 7 | Client tests the CRM against the agreed requirements (acceptance checklist, §8) | Client | Step 6 |
| 8 | Resolve reported defects and any missing **agreed** functionality | Zeploy Tech | Defect reports |
| 9 | Client acceptance and completion of the handover | Client and Zeploy Tech | Steps 7–8; terms in §8.5 |

---

## 2. Scope boundaries

### 2.1 Included in the agreed Version 1

**Built and verified:**
- **Security and access:** sign-in, six roles enforced on the server, sign-in history, Security settings (retention deletion **off**).
- **Dashboard:** everything except the aging matrix.
- **Leads:** list, pipeline with drag-and-drop, detail, follow-ups, to-dos, duplicates, re-inquiries, lost approvals, reviews, click-to-call, recordings, documents.
- **Notifications.**
- **Clients, Projects, Inventory, Bookings.**
- **Tasks and proposals, Meetings, Teams, duty roster, daily reports, Targets, Performance** (call metrics "not available").
- **Finance:** payments, reversals, outstanding, collections and outstanding reports, audited CSV.
- **HR and My Workplace:** employees, holidays, upcoming holidays, sign-in history.

**New for Version 1 (§3):** E1, E2, E3, and E4 / E5 if signed (see their cut-offs).

**Production deliverables (§4):** P1–P5.

### 2.2 Deferred (not part of this handover)

Each item lists its reason in §9:
- leave and leave-roster-rotation integration;
- team regions and weekends;
- lead shift on deactivation;
- payment proof attachments;
- proposal editing and task-assignment restrictions;
- task types;
- installment due dates;
- current-price proposals;
- floor prices and ROI;
- receipt format;
- PDP / CDP;
- the Critical flag and Pipeline pressure;
- calls from recordings;
- employee records without logins;
- recording deletion;
- original-assignment counting;
- the attendance decision (CR-1), floor map (CR-2), refunds (CR-3);
- the older open items.

### 2.3 Excluded external integrations

Not part of this delivery unless already in a signed agreement, and none is in the signed quotation:
- Meta (Facebook / Instagram) Lead Ads;
- TikTok Lead Generation;
- WhatsApp;
- email or SMS sending;
- AI call analysis;
- telephony / call-data APIs;
- payment gateways and bank integrations;
- maps.

Data migration from SaleStorm is also deferred (Q-P5). Details, credentials and client dependencies are in `EXTERNAL_INTEGRATIONS.md`. **None is started without explicit approval.**

---

## 3. Development items (unchanged boundaries)

### E1 Proposal and payment defaults (Q41, Q42, Q33 "Pay order")

| | |
|---|---|
| **Functionality** | Manager discount cap 5%. Default down payment 25%. Payment method "Pay order". |
| **How** | Code: the down-payment fallback constant changes from 30 to 25 for fresh installs. Values are set through the existing audited settings screens in each environment. In **production** they are applied during initial setup (P1 / checklist). Development records are not rewritten by any migration. |
| **Roles** | Admin and Super Admin change settings. |
| **Acceptance** | A new proposal starts at 25%. A manager can't exceed 5%. "Pay order" is selectable. Existing proposals keep their saved figures. |
| **Tests** | Update proposal tests that assume 30%. Integration: manager cap; new method; existing proposal unchanged. |
| **Estimate** | **2 h** |

### E2 Proposals: only Available units (Q48)

| | |
|---|---|
| **Functionality** | The picker offers only Available units; the server refuses others. Existing proposals on other units stay readable and printable. |
| **Acceptance** | Reserved, Booked, Sold and Partially booked units aren't offered, and the API refuses them. Existing proposals display. |
| **Tests** | Unit (filter); integration (refusal; legacy proposal readable). |
| **Estimate** | **2.5 h** |

### E3 Account management: Settings → Users (Q2; Q3 manual deactivation)

| | |
|---|---|
| **Functionality** | Admin and Super Admin can:<br>- list users;<br>- create a user (name, email, role, initial password);<br>- change name or role;<br>- reset a password;<br>- deactivate or reactivate.<br><br>In production, this is how the client's Super Admin creates every account after the first one (P1). |
| **Role safeguards** | - No one can deactivate themselves.<br>- The last active Super Admin can't be deactivated or demoted.<br>- Pending C-1, **only a Super Admin can create, change, reset or deactivate a Super Admin account**, and only a Super Admin can grant the Super Admin role.<br>- HR, Manager, Agent and Accountant get Access denied on the page and 403 from the API.<br>- Email is unique (existing index).<br>- Passwords use the existing `hashPassword`.<br>- Passwords are never stored in logs, audit rows or responses after creation. |
| **Authentication** | **Unchanged.** Deactivation sets `users.status = inactive`. Sign-in already refuses inactive accounts (`login.ts`), and session lookup only loads active users (`session-store.ts`), so access ends immediately. |
| **Audit** | Create, role change, password reset, deactivate and reactivate are each audited. |
| **Database** | **No migration** (existing `users` columns; who and when come from the audit log). |
| **Acceptance** | Admin creates an agent, and the agent signs in. Admin deactivates them: the open session stops working and sign-in shows "This account is inactive." Reactivation restores sign-in. An Admin can't touch a Super Admin. The last Super Admin is protected. Other roles are refused. Existing users, roles and passwords are unchanged. |
| **Tests** | Unit: guard table. Integration: the full lifecycle, every safeguard, duplicate email, audit rows. Playwright (desktop and mobile): create, sign in, deactivate, signed out; refusal for other roles. |
| **Estimate** | **16 h** |

### E4 Reversal approval by Admin and Super Admin only (Q31)

- **Blocked until signed client approval (S-1).**
- **Cut-off:** Thu 5 Nov 12:00. Even when signed, it is scheduled only after E1–E3 and P1–P5 (§5).
- **Acceptance:** manager approval hidden and 403; Admin approves; existing pending requests approvable by Admin; Super Admin emergency exception kept.
- **Estimate:** **3 h**.

### E5 Recording playback: Manager, Admin and Super Admin only (Q52)

- **Blocked until S-1 and C-32.**
- **Cut-off:** as E4.
- **Acceptance:** agents keep upload and the list, but get no player and 403 on the route; managers, Admin and Super Admin play with byte ranges; documents unaffected.
- **Estimate:** **3.5 h**.

**Permanent recording deletion is not implemented** until the client clarifies the deletion policy (C-33).

---

## 4. Production preparation (new required work)

These items exist because a clean production database is **not usable** with migrations alone:
- Migrations insert only payment methods and proposal defaults.
- Lead sources, cities, budget ranges and lost reasons come only from the **development** seed script, which also creates development accounts and refuses to run in production.
- There is no screen for those lists, and no way to create the first Super Admin.

### P1 Controlled production setup script

`scripts/setup-production.mjs` (new). It runs once on the server after migrations.

**Guards. It refuses to run unless all of these hold:**
- `NODE_ENV=production`;
- an explicit `--confirm-database <name>` that matches the connected database name;
- no Super Admin exists yet (for the account step).

It never reads `.env.local`.

**What it does:**
- **Lookup lists:** inserts the **client-confirmed** sources, cities, budget ranges and lost reasons from a reviewed file (`setup/production-lookups.json`). It is idempotent: existing rows are never changed or removed.
- **First Super Admin:**
  - name and email come from arguments;
  - the password is typed by the operator at a hidden prompt;
  - the password is never printed, logged or saved to a file;
  - an audit row is written.
- **Copies nothing from development:** no development or test data, no dev accounts, no demo project or team.

**Tests:** integration on the **test** database:
- refuses without the flags or with a wrong database name;
- refuses a second Super Admin;
- idempotent lookups;
- password hashed and never echoed.

**Estimate:** **4 h**.

### P2 Backup and restore scripts

`scripts/ops/backup.sh` and `scripts/ops/restore.md` (new).
- **Backup:** `pg_dump` (custom format) plus an archive of `FILE_STORAGE_DIR`, with a shared timestamp.
- **Off-server copy:** to the client's backup destination.
- **Retention:** 7 daily, 4 weekly, 3 monthly (`SECURITY_AND_PRIVACY.md` §9).
- **Restore procedure:** restore into a **temporary database on the production server**, verify row counts and file presence, then drop the temporary database. The live database is never touched.

**Local verification:** against the **test** database only, which the test suite resets routinely. No new database is created and the development database is never touched.

**Estimate:** **3 h**.

### P3 Deployment runbook

Consolidates `DEPLOYMENT_PROXY.md` into an ordered runbook:
- server packages (Node 24, PostgreSQL, Caddy 2.5+);
- app user and folders;
- firewall (22 / 80 / 443 only);
- Caddyfile;
- process manager (systemd service with a graceful stop);
- environment file and permissions;
- the build, `npm run db:migrate`, P1;
- the scheduler for `job:prune-signin-logs` (**deletion stays off**) and backups;
- log locations;
- the update procedure.

**Estimate:** **3 h**.

### P4 Handover documents

- **Administrator guide:**
  - first sign-in;
  - creating users (E3);
  - roles and teams;
  - projects, units, lookups;
  - settings (E1 values);
  - Security settings (retention off until the signed approval);
  - backups and restores;
  - where logs are kept.
- **The acceptance checklist (§8.2)** and the **defect report template (§8.3).**

**Estimate:** **3 h**.

### P5 Clean-install rehearsal (local, test database)

From an empty test database:
1. migrations;
2. P1 with sample lookups;
3. production build and start;
4. a Playwright smoke run (sign in as the new Super Admin, create a user, create a lead);
5. P2 backup, then restore into the test database.

This proves the procedure before it touches the client's server.

**Estimate:** **2 h**.

---

## 5. Effort, capacity and timeline

**Assumptions:**
- One developer.
- Approval of this plan at the earliest **today, Tue 3 Nov**, so building starts **Wed 4 Nov**.
- About 7 focused hours per day.
- Builds and test runs are counted inside those hours.

| Work | Hours |
|---|---|
| E3 account management | 16 |
| E1 defaults | 2 |
| E2 available units | 2.5 |
| P1 setup script | 4 |
| P2 backup and restore | 3 |
| P3 runbook | 3 |
| P4 handover documents | 3 |
| P5 clean-install rehearsal | 2 |
| Regression after each item, plus documentation updates | 4 |
| **Required before handover** | **39.5 h** |
| E4 + E5 (only if signed) | 6.5 |
| Server deployment and configuration (needs client access, §6) | 7–8 |

| Window | Hours |
|---|---|
| Wed 4 – Sat 7 (4 build days) | 28 |
| Mon 9 (freeze, verification, finishing documents) | 7 |
| **Weekday capacity before 10 Nov** | **35** |

**Result:** the required work (39.5 h) is **4.5 h over** weekday capacity, before E4 / E5 and before any server work. Zeploy Tech must choose one of these options (decision **T-1**):
- **(a)** Work 4.5 h on Sun 8 Nov.
- **(b)** Move E2 (2.5 h) and part of P4 to the client-testing period (step 8).
- **(c)** Move the handover target to Wed 11 or Thu 12 Nov.

**E4 and E5 almost certainly do not fit before 10 Nov, even if signed.** They would be delivered during the client-testing period (step 8) as agreed functionality. Their scope and the signature requirement are unchanged.

**Server deployment** (7–8 h, plus up to 24–48 h for DNS) can only start once the client provides the items in §6.

| If the client provides hosting, domain and access… | Then |
|---|---|
| By **Thu 5 Nov 18:00** | Server provisioned Mon 9 afternoon; deployment, setup, security checks and restore test on **Tue 10**; handover session Tue 10 or Wed 11 |
| After Thu 5 Nov | On 10 Nov, Zeploy Tech hands over a code-complete, rehearsed release with the runbook. Deployment completes **1–2 working days after** access is received, plus DNS time |

### Day-by-day

| Day | Work | Exit check |
|---|---|---|
| **Tue 3 Nov** | Zeploy approval. Send the client: S-1 signature; C-1, C-32; the production dependencies (§6: hosting, domain, DNS, access, backup destination, initial users, lookup lists, company details); decision T-1 recorded | Requests sent |
| **Wed 4** (7 h) | E3 backend, guards, audit, tests | Integration green |
| **Thu 5** (7 h) | E3 screen and Playwright; **12:00:** S-1 / C-32 go or no-go for E4 / E5; **18:00:** hosting cut-off for a 10 Nov deployment | Full suite green |
| **Fri 6** (7 h) | E1, E2, P1 setup script and its tests | Full suite green |
| **Sat 7** (7 h) | P2 backup and restore, P5 clean-install rehearsal on the test database, regression; **18:00 feature freeze** | Rehearsal passed |
| **Sun 8** | Only under T-1 option (a): P3 and P4 (4.5 h) | — |
| **Mon 9** (7 h) | **12:00 code freeze.** Typecheck, lint, full Vitest, full Playwright (desktop and mobile), schema drift, production build. Finish P3 and P4. If access is available: start server provisioning | All checks green |
| **Tue 10** | **Version 1 date.** If access was available: deploy, run setup, security checks, backup and restore test, then the handover session. Otherwise: hand over the release and runbook; deploy on access | Checklist sections 1–8 complete, or the release handed over |
| **After handover** | Client acceptance testing (§8); defects fixed; E4 / E5 if signed | Client acceptance |

---

## 6. Client-provided dependencies (not assumed available)

| ID | Needed from the client | Needed for |
|---|---|---|
| H-1 | Server: a VPS or dedicated server (recommended minimum 2 vCPU, 4 GB RAM, 60 GB SSD, Ubuntu 24.04 LTS), paid and owned by the client | Step 3 |
| H-2 | Server access for Zeploy Tech: an SSH user with sudo (key-based), or a client technician available to run the runbook | Step 3 |
| H-3 | Domain name and access to its DNS (to add an A record for the CRM, e.g. `crm.<domain>`) | TLS, step 3 |
| H-4 | Database choice: PostgreSQL on the same server (default), or a managed PostgreSQL with connection details | Step 3 |
| H-5 | Off-server backup destination (object storage bucket or second server) and its credentials | P2, step 3 |
| H-6 | Name and email of the client's **first Super Admin**, who will be present to set the password at the prompt | P1, step 5 |
| H-7 | List of initial users: name, email, role, team | Step 5 (entered by the client's Super Admin through E3) |
| H-8 | Confirmed lookup lists: lead sources, cities, budget ranges, lost reasons. The development lists are drafts. | P1 |
| H-9 | Projects and units to enter. There is **no import** (deferred), so the client enters them through the app, or agrees who does. | Client testing |
| H-10 | Company details for printed proposals (name, address, logo) | Proposal print |
| H-11 | Network: is any CDN or load balancer in front (C3)? | P3 |
| H-12 | Who looks after server updates and backup checks after handover (maintenance is not included; Q-T3) | P4 |
| S-1 | Signed questionnaire | E4, E5, Q50 |
| C-1, C-32 | Clarifications | E3 (default applies), E5 |

---

## 7. Database and environment rules

- **Development database:** kept as it is. Never reset, overwritten or deleted.
- **No demo or presentation database.**
- **Test database** (separate, routinely reset by the test suites) is used for P1 / P2 / P5 verification.
- **Production database:**
  - created clean on the client's server and owned by the client;
  - schema created **only by the migrations** (`npm run db:migrate`, additive);
  - initial data **only through P1** (client-confirmed lookups, first Super Admin) and then the application.
  - **Never** copy development records, test fixtures or fictional records into it.
  - `db:seed` already refuses production and must never be run there.
- **Environments are completely separate:** different database servers or at least different databases and credentials, different secrets, and separate storage folders.
- **Before handover, verify:**
  - database connectivity from the app;
  - `drizzle-kit check` and a migration status check;
  - a successful backup;
  - a restore into a temporary database.

---

## 8. Client acceptance

### 8.1 What is delivered
The deployed CRM with the features in §2.1, the client's initial setup (§4 P1, §6), and the handover documents (P4).

### 8.2 Acceptance checklist (summary; full version in `PRODUCTION_HANDOVER_CHECKLIST.md` §9)

The client's testers sign in with their own production accounts and confirm each agreed feature for each role:
- **Super Admin and Admin:** users (E3), settings (E1), Security settings.
- **Manager:** leads, pipeline, approvals, proposals (E1, E2), team views.
- **Agent:** own leads, follow-ups, notifications, uploads.
- **Accountant:** payments, reversals, reports, CSV.
- **HR:** employees, holidays.
- **Everyone:** My Workplace; phone-width use.

### 8.3 Defect reporting and resolution (proposal; to be agreed in writing)

**Reporting:**
- One reporting channel, chosen by the client (email or a shared sheet).
- Each report gives: the feature, role, steps, expected vs actual result, screenshot, date and time.

**Severity:**

| Level | Meaning |
|---|---|
| 1 Blocker | An agreed feature unusable, data wrong, or a security issue |
| 2 Major | Agreed feature works incorrectly; workaround exists |
| 3 Minor | Cosmetic or wording |

**Defect vs change request:**
- A **defect** is agreed Version 1 functionality not working as documented.
- A new or changed requirement is a **change request**, reviewed and quoted separately (per the quotation).

**Resolution:** Zeploy Tech acknowledges, fixes in the codebase with tests, and redeploys using the runbook's update procedure. Each fix is recorded in a defect log.

### 8.4 Proposed definition of successful acceptance (to be agreed in writing)
- Every checklist item for the agreed Version 1 features passes in production.
- No open severity 1 or 2 defects.
- Deferred items (§9), change requests and excluded integrations are **not** acceptance conditions.
- Acceptance is confirmed in writing by the client.

### 8.5 Payment terms: not redefined; ambiguities to settle in writing

The quotation states: 50% upfront (PKR 87,500) and 50% "upon completion of Version 1" (PKR 87,500), with ownership passing after final payment. This plan does not change those terms. These points are ambiguous and should be agreed with the client in writing:
1. Does "completion of Version 1" mean the 10 Nov date, deployment on the client's server, or written acceptance after testing (Q-P1)?
2. If deployment waits on client-provided hosting, domain or access (§6), does that delay "completion"?
3. Several quoted lines depend on answers the client hasn't given yet: leave, attendance (commercial decision), income / expense, receipt templates. Are those part of "Version 1 completion", or a later phase?
4. How long is the acceptance testing period, and what happens if no response is received?
5. Does ownership transfer cover the deployed server only, or also the source repository (now private), and when exactly?
6. Maintenance isn't included. Is there a defect-fix period after acceptance, and for how long?

---

## 9. Deferred features

| Feature | Refs | Reason |
|---|---|---|
| Leave requests, approvals, balances, My Leaves | Q4, Q6–Q17 | **Blocked** on C-4, C-5, C-13; 4–5 days of work |
| Leave → roster and rotation | Q18, Q19 | Needs leave; C-14, C-15 |
| Team region; team weekends | Q5, Q9 | C-3, C-8 |
| Lead shift on deactivation | Q3 | C-2 |
| Payment proof attachments | Q33 | C-23 |
| Proposal editing (Super Admin only); task assignment (Admin only) | Q36, Q45 | C-25, C-29; remove access |
| Task statuses / types | Q46 | **Blocked** on C-30 |
| Installment due dates (10th) | Q43 | C-27 |
| Proposals at current unit price | Q47 | C-31 |
| Floor prices and ROI | Q44 | **Blocked** on C-28 |
| Receipt format | Q29 | **Blocked** on C-21 |
| PDP / CDP | Q34 | **Blocked** on C-24 |
| Critical flag; Pipeline pressure | Q23, Q28 | **Blocked** on C-17, C-20 |
| Calls from recordings | Q27 | C-19 |
| Employee records without login | Q1 | Former stretch item; no capacity |
| Recording deletion (hide or erase) | Q53 | No capacity; permanent erase also needs C-33 |
| Original-assignment counting | Q25 | C-18; no capacity |
| Sign-in log automatic deletion | Q50 | Needs S-1 and the production scheduler; stays **off** at handover |
| Attendance | Q20–Q22 | CR-1, commercial decision; C-16 |
| Floor map on proposals; refunds | Q49, Q32 | CR-2, CR-3 |
| Older open items | Clarifications §D | Aging matrix, notification rules, SPU / holds / stage gates, receipt and sales-order templates, income / expense, merge, imports, email, 2FA, lead deletion, document retention |

---

## 10. Protecting existing functionality
- **Records:** no existing record is deleted, rewritten or re-priced.
  - E1 settings change only through audited screens.
  - E2 filters new selections only.
- **Databases:** E1–E5 need **no migration**; any later schema change is **additive**. The development database is never reset. The test database is used for all verification.
- **Permissions:** only E4 and E5 remove access, and only after signed approval. The role matrix tests change only for approved changes.
- **Authentication:** sign-in, sessions, rate limiting, IP handling and security headers are unchanged.
- **Every item ends with** typecheck, lint, full Vitest and full Playwright on the test database. Release candidates also pass schema drift and a production build with no warnings.

## 11. Delivery risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Hosting, domain or access not provided by Thu 5 | **High** | Deployment after 10 Nov | Rehearsed release and runbook ready on 10 Nov; deploy on access |
| Required work 4.5 h over capacity | Certain | Schedule | Decision T-1 today |
| DNS propagation or TLS issuance delays | Medium | Go-live delay | Add the DNS record as soon as the domain is known; Caddy issues certificates automatically once DNS resolves |
| Lookup lists or user list not confirmed | Medium | Unusable lead forms at go-live | H-7 / H-8 requested today; P1 can be re-run idempotently to add lists |
| Expectation gap: quoted lines not ready (leave, attendance, income / expense, receipt templates) | **High** | Commercial | §8.5 agreed in writing; deferred list shared at handover |
| No maintenance agreement | Medium | Backups unmonitored after handover | H-12; administrator guide covers checks |
| Single developer | Medium | Schedule | Freeze rules; E4 / E5 and the deferred items can be cut without affecting what is delivered |
| Production data entry without imports (projects, units) | Medium | Client testing delayed | H-9: agree who enters data |

## 12. Awaiting explicit approval (Zeploy Tech)
1. E1, E2, E3 (with the E3 safeguards) and P1–P5 as specified.
2. Decision **T-1** (Sunday work, move E2 / part of P4, or move the handover date).
3. E4 / E5 remain blocked until signed client approval.
4. Sending the client the §6 dependency list, S-1, C-1 and C-32.
5. The proposed acceptance definition (§8.4) and defect process (§8.3), for written agreement with the client, plus the §8.5 questions.

**Nothing is implemented, committed, pushed or deployed until approved.**
