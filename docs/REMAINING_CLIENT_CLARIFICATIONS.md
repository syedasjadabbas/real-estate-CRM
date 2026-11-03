# Remaining client clarifications

Prepared 2 Nov 2026 after the questionnaire answers (`CLIENT_ANSWERS_RECONCILIATION.md`). Questions are written in plain company-policy language so they can go to the client as they are. Each one says why it matters and what we would build in the meantime. Nothing is built on a guess.

**Priority:**
- **Blocking:** the feature can't be built at all.
- **Needed:** the feature can be built, but one rule would be guessed.
- **Confirm:** we have a reading and only need a yes or no.

---

## S. Approval

| ID | Question | Why | Priority |
|---|---|---|---|
| S-1 | Please sign and date the questionnaire: name, designation, signature, date. | Written approval is required before automatic deletion of old sign-in records is turned on (Q50), before any user loses an access they have today (Q31, Q36, Q45, Q52), and before change requests are quoted. | **Blocking** |

## P. Production deployment dependencies (added 3 Nov 2026)

There is no demo environment: Version 1 is deployed on the client's own server. Nothing below is assumed available. Details are in `VERSION_1_EXECUTION_PLAN.md` §6.

| ID | Needed from the client | Priority |
|---|---|---|
| H-1 | Server (VPS or dedicated; ≥ 2 vCPU, 4 GB RAM, 60 GB SSD, Ubuntu 24.04 LTS), client-paid | **Blocking** for deployment |
| H-2 | SSH access for Zeploy Tech (key-based, sudo) or a client technician | **Blocking** for deployment |
| H-3 | Domain and DNS access; CRM hostname | **Blocking** for deployment |
| H-4 | Database: PostgreSQL on the same server, or managed PostgreSQL details | Needed |
| H-5 | Off-server backup destination and credentials | **Blocking** for handover (backup and restore must be verified) |
| H-6 | First Super Admin's name and email, present at setup | **Blocking** for setup |
| H-7 | Initial users: name, email, role, team | Needed |
| H-8 | Confirmed lead sources, cities, budget ranges, lost reasons | **Blocking** for usable lead forms |
| H-9 | Who enters projects and units (no import in Version 1) | Needed |
| H-10 | Company name, address, logo for printed proposals | Needed |
| H-11 | CDN or load balancer in front? | Confirm |
| H-12 | Who maintains updates and backups after handover | Needed |

**Acceptance and payment.** Please agree in writing the six questions in `VERSION_1_EXECUTION_PLAN.md` §8.5. They are not proposals to change the quoted terms.

## C. Clarifications on the answers received

### HR, accounts and leave

| ID | Q | Question for the client | Why it matters | Priority |
|---|---|---|---|---|
| C-1 | 2 | May an **Admin** create, change or deactivate a **Super Admin** account, or only a Super Admin? | Prevents an Admin from removing the owner's access. Our default would be Super Admin only. | Needed |
| C-2 | 3 | When an employee is deactivated and their leads are shifted: should **all** their leads move, or only open ones (not Booked or Lost)? Should their pending follow-ups, tasks and meetings move to the new person too? | The answer decides what the one-step "shift" changes. | Needed |
| C-3 | 5, 9 | Some staff belong to **more than one team**. Which team decides their holiday region and weekend? Or should each person belong to only one team? | A person in two teams could get two regions or two weekends. | Needed |
| C-4 | 6 | For the 2-step leave approval: who approves first and who approves second, e.g. **Team Manager first, then HR**? If the employee has no team manager, who takes the first step? | The two approvers and their order define the whole leave workflow. | **Blocking** for leave |
| C-5 | 7 | For leave of Managers, HR, Admins and Super Admins: is Super Admin approval **one step only**? And who approves a **Super Admin's own** leave (another Super Admin, or self-approval recorded)? | One person can't approve their own request unless you allow it. | **Blocking** for leave |
| C-6 | 1, 6 | Staff with **no CRM login** can't submit leave themselves. Should HR submit leave on their behalf, and does the same 2-step approval apply? | Defines leave for non-login staff. | Needed |
| C-7 | 4 | Please confirm the yearly allowance is **30 days** for everyone. | Q4 said "same for all" but did not state the number. | Confirm |
| C-8 | 9 | Leave is counted in calendar days (Q8), so weekends don't reduce leave. Are team weekends needed **only** for the duty roster and attendance? Which days does each team have off? | Avoids building weekend rules into leave by mistake. | Needed |
| C-9 | 10 | Should the leave type be shown as **"Medical"** instead of "CPL"? Is a medical certificate or note required? | Labels on forms and reports. | Confirm |
| C-10 | 13 | How should a new joiner's allowance be prorated, e.g. 30 ÷ 12 = 2.5 days for each remaining month including the joining month? Round to whole or half days? | Different methods give different balances. | Needed |
| C-11 | 14 | Is the leave year **January to December**? | Defines when balances reset. | Confirm |
| C-12 | 15 | To cancel approved leave, does the **employee request** the cancellation and an Admin or Super Admin approve it? Are the cancelled days **returned to the balance**? Can leave already taken (past days) be cancelled? | Defines the cancellation workflow. | Needed |
| C-13 | 17 | A leave from 28 December to 3 January: should **(a)** the December days come from the old year and the January days from the new year, or **(b)** all days come from the old year? | The answer can be read both ways. | **Blocking** for that case |
| C-14 | 18 | Approved leave appears on the duty roster. If a manager has already set that day (e.g. "In office"), should the leave **replace** it? Should it appear on every team roster the person belongs to? | Avoids silently overwriting a manager's entry. | Needed |
| C-15 | 19 | Agents on leave are skipped by automatic lead rotation. Should **"Leads off"** on the roster also skip rotation? Should managers be **blocked** from manually assigning a lead to someone on leave, or only warned? | Rotation rules. | Needed |

### Attendance (new module; see `CHANGE_REQUESTS.md` CR-1)

| ID | Q | Question for the client | Why it matters | Priority |
|---|---|---|---|---|
| C-16 | 21, 22 | (a) How is attendance captured: employees click **Check in / Check out** in the CRM, HR enters it, or imported from a machine? (b) Office start and end time, per team or company-wide? (c) After how many minutes is someone **late**? (d) Are breaks recorded by the employee (start/end) or a fixed allowance? (e) What counts as **absent**: no check-in on a working day without approved leave? (f) May employees **see their own** attendance? | Without these, attendance can't be designed or quoted. | **Blocking** for CR-1 |

### Performance

| ID | Q | Question for the client | Why it matters | Priority |
|---|---|---|---|---|
| C-17 | 23 | "Critical" is meant to flag an **agent** who needs attention. Your answer mentions **new leads** and **meeting-commitment leads**. Do you mean an agent is Critical when, for example, they have more than **X new leads untouched for Y hours**, or more than **X leads with a promised meeting not held**? Please give the numbers. Or did you mean a **lead** should be marked Critical? | We can't build a flag without the rule. | **Blocking** for FR-153 |
| C-18 | 25 | "Original assignment date" means the first time a lead was given to an agent, even if it was moved later. Correct? | Confirms the reading. | Confirm |
| C-19 | 27 | Calls won't be entered by hand. Should each **uploaded call recording count as one call** (its length as call minutes)? If not, call figures stay "not available". | Calls drive targets, daily reports and performance. | Needed |
| C-20 | 28 | Pipeline pressure should use meetings and financial commitment. Please describe how, e.g. "number of meetings held plus the value of tokens received in the period, per agent", and the period (week, month). | No formula was given. | **Blocking** for that metric |

### Finance

| ID | Q | Question for the client | Why it matters | Priority |
|---|---|---|---|---|
| C-21 | 29 | Receipt format "BH-GF/FF/SS-123": (a) what is **BH**: a project code? (b) Are GF/FF/SS floors? Q44 uses **SF** for Second Floor; which is correct? (c) What format do other projects use? (d) Does the number **restart** for each project or floor, or run continuously? (e) Payments not tied to a floor? (f) What do **reversals** look like? | The receipt format is printed on legal documents and can't change later without confusion. | **Blocking** for receipt numbers |
| C-22 | 32 | When a booking is cancelled after payment: who **decides the deduction** amount, who **approves** the refund, and should the deduction be kept as company **income**? Does the unit become available again immediately? | Refunds are a new financial workflow (`CHANGE_REQUESTS.md` CR-3). | **Blocking** for CR-3 |
| C-23 | 33 | We read the methods as **Online transfer, Cash, Cheque, Pay order**, and "online receipt" and "cash images" as **proof** (a photo or screenshot) attached to the payment. Correct? Is a proof attachment **required** for every payment? | Attachments are new scope (CR-4). | Needed |
| C-24 | 34 | What do **PDP** and **CDP** stand for? Are they payment types, like token? From which booking stage may each be collected? | These terms are not defined anywhere in the project. | **Blocking** for payment types |

### Tasks and proposals

| ID | Q | Question for the client | Why it matters | Priority |
|---|---|---|---|---|
| C-25 | 36 | Only Super Admin edits proposals. May the person who creates a proposal **fix it before printing** (e.g. the same day), or is it locked as soon as it's saved? May Admins edit? | Locks out every user except Super Admin from corrections. | Needed |
| C-26 | 42 | The down payment changes to 25%. Should the default **number of installments** stay at **36**? | Not answered. | Confirm |
| C-27 | 43 | Installments fall on the 10th of each month. Which month is the **first** installment: the month after the proposal date, or after the down payment? When is the **down payment** due? | Needed to generate the dates. | Needed |
| C-28 | 44 | The prices GF 10,824 / FF 9,593 / SF 8,624 per sq ft: (a) for **which project(s)**? (b) Should they **replace** the units' own prices in proposals, or apply only when a unit has no price? (c) What is the **ROI rate** per sq ft (not given)? | Wrong prices on proposals are a commercial risk. | **Blocking** for price defaults |
| C-29 | 45 | Only Admin and Super Admin assign tasks. May Agents and Managers still create tasks **for themselves**? Should **HR and Accountants** be able to receive tasks? | Today agents and managers create their own tasks. | Needed |
| C-30 | 46 | The items you listed (contacted client, follow up call, call attempt, meeting done, meeting aligned, payments) look like **types of work**. A task also needs a status such as Open or Done to know if it is finished or overdue. Should these become **task types**, keeping Open / In progress / Done / Cancelled? Please give the complete list ("etc"). | Replacing statuses would break overdue tasks and To-dos. | **Blocking** for that change |
| C-31 | 47 | Proposals will always show the **current** unit price. A proposal printed last week may then differ from what the system shows today. Should the system keep a copy of what was **printed**, or simply show today's price? | Disputes with buyers over quoted prices. | Needed |

### Recordings

| ID | Q | Question for the client | Why it matters | Priority |
|---|---|---|---|---|
| C-32 | 52 | Agents will be able to **upload** recordings but **not listen** to them, including their own calls. Is that intended? | Removes access agents have today. | Confirm |
| C-33 | 53 | When a Super Admin deletes a recording, should the audio be **permanently erased** (can't be recovered, except from a backup), or hidden but kept on the server? | Permanent deletion can't be undone. | Needed |

## D. Earlier questions the questionnaire did not cover

These are still open from the module plans. Current handling is unchanged until answered.

| ID | Area | Question | Current handling |
|---|---|---|---|
| M-Q1 – M-Q5 | Dashboard (FR-014) | Aging × meetings matrix: engaged-pipeline definition, how meetings are counted, the window, month length, average-per-owner divisor (`DASHBOARD_PLAN.md` §7) | Card explains it is waiting |
| D1, D2 | Dashboard | Owner in several teams; which date counts a lead as lost | Documented proposals in use |
| N2 – N6 | Notifications | No-manager lost requests, notify on approval, other events, expiry, email or push (`NOTIFICATIONS_PLAN.md`) | Documented events only. N1 is configurable: 30 minutes set in tests, off in production until set |
| Q-B1 | Bookings | SPU strips and 50% shares: sizing, pricing, several shares per buyer, when Sold | Whole-unit only |
| Q-B2 | Bookings | Token amount → hold duration; auto-release | No automatic hold expiry |
| Q-B3 | Bookings | Mandatory stages, who moves each, documents or payments per stage | Proposed defaults |
| Q-B4 | Bookings | When a unit becomes Reserved → Booked → Sold | Proposed defaults |
| Q-B5 | Bookings | Provisional receipt and Sales order templates and numbering (relates to C-21) | Not built |
| Q-B7 | Clients | Auto-create a client on confirmation | Built as proposed |
| Q-F4 | Finance | Income and expense categories (FR-200 / 201) | Not built (F3) |
| Q-F8 | Finance | Can managers and agents see itemised payments? | Paid total only for agents |
| Q-F9 | Finance | Payment attachments (relates to C-23) | None |
| Q-F13 | Finance | How far back a payment may be dated | Proposed default |
| Q-F15, Q-F16 | Finance | Accountant dashboard KPIs; income vs expense report | Not built (F5) |
| Merge 1–6 | Leads (FR-032) | Shared-phone merge rules (`LEADS_MODULE_PLAN.md` §13) | View only |
| Q-P5 | Imports | Migration from SaleStorm; CSV of leads and units (FR-043, FR-075) | Not built |
| Q-T2 | Email | Email provider and which emails | None |
| Q-R5 | Security | 2FA for admins and accountants | Not in V1 |
| Q-L7 | Leads | Who can delete leads | No deletion |
| Docs | Documents | Retention and deletion of lead **documents** (Q53 covered recordings only) | Kept; no delete |
| Formats | Files | AMR / 3GP recordings, HEIC images, Office previews | Refused / download only |
| Q12 | HR | Fixed lists for departments and designations | Free text |
| TQ2, TQ4, TQ5, TQ7, TQ8 | Teams | Managers editing members; roster lock for admins; correcting past daily reports; period time zone; manager targets | Documented defaults |
| C3 | Hosting | CDN or load balancer in front of Caddy | Caddy only |
| Q-P1 | Commercial | Does "completion of Version 1" mean the 10 Nov date, deployment on the client's server, or written acceptance after testing? See `VERSION_1_EXECUTION_PLAN.md` §8.5 for the related questions | Unanswered |
| Q-P6, Q-T3 | Hosting | Who owns domain and server; who maintains backups after handover | Unanswered |
