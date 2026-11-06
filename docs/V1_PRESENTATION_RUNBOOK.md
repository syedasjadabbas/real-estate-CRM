# V1 presentation runbook

A walkthrough of Version 1 using the **production build** on the **local development database**. It uses safe records you create on the day. It adds nothing to production, and there is no production server yet.

This exact sale is covered by `e2e/v1-critical-path.spec.ts`, so each step below has passed through the real pages.

## Before the presentation

1. Plug the laptop in and keep the lid open. It slept during test runs three times on 5 Nov.
2. Run the read-only check and fix anything marked `NEED`:

   ```bash
   node scripts/ops/presentation-preflight.mjs
   ```

   After the 6 Nov rehearsal it reports `NEED` for whole units (1 of 2). That is expected: the live run needs one, and **VERIFY-B202** is kept for it. Book only that unit on the day. A further rehearsal needs another unit, added through **Inventory → Add unit** with sale model **Whole**.
3. Stop any running dev server, then start the production build. Use this, not the dev server: the dev server shows developer badges on screen and is slow the first time each page opens.

   ```bash
   npm run build
   ```

   ```bash
   npm run start -- --port 3100
   ```

4. Open http://localhost:3100 and sign in once with each account below. Passwords are in `.dev-credentials`, which is not shown here.
5. Use one browser window per person, or a private window, so each stays signed in.
6. The rehearsal ran on 6 Nov using VERIFY-A102. Its records are named "Rehearsal" and stay in the lists: Rehearsal Buyer as a lead and client, its booking, and Receipt 5. The dashboard and finance figures include them, so mention this if asked. Use a different buyer name on the day.

| Who | Account | Used for |
|---|---|---|
| Manager | `manager@mz.local` | The sale, stages, confirmation |
| Agent | `agent1@mz.local` | What an agent can and can't see |
| Accountant | `verify.accountant@mz.local` | Posting the payment, reports |
| Super Admin | `superadmin@mz.local` | Settings, Cities, audit log |

## The walkthrough, about 20 minutes

| # | As | Do | Point out |
|---|---|---|---|
| 1 | Super Admin | Open the Dashboard, then click a tile | Tiles open the exact leads they count |
| 2 | Manager | **Leads → Add lead**, choose City → **Other**, type a phone number, then a real town | Numbers are refused as a city |
| 3 | Manager | Open the lead, reassign it to an agent | The timeline records it |
| 4 | Manager | **Meetings → New**, choose the lead | The lead's history shows it |
| 5 | Manager | **Tasks → New** | Tasks appear in the list |
| 6 | Manager | **Bookings → New booking**: lead, unit, rate, token | The total calculates; the unit becomes Reserved and leaves the list |
| 7 | Manager | Move the booking to **Token pending** | Payments open at this stage |
| 8 | Accountant | **Finance → Record payment** | A receipt number is issued; paid and outstanding update |
| 9 | Manager | Move through each stage, then **Confirm booking** | The lead becomes Booked and a client is created |
| 10 | Manager | Open the lead's timeline | The whole history, including the client link |
| 11 | Agent | Open Leads, then try Settings → Cities | Agents see their own leads and are refused the screen |
| 12 | Accountant | **Finance → Reports**, download a CSV | Figures match the ledger |
| 13 | Super Admin | **Settings → Cities**, then **Audit log** | Every change is recorded |

## What not to demonstrate

Each of these waits on a client decision or is not in Version 1. Say so if asked.

| Area | Status |
|---|---|
| **Provisional receipt and Sales order tabs on a booking** | Quoted, but not built: they wait for the client's template (Q-B5). Show the receipt in Finance instead |
| **Attendance** | Quoted under Performance, but not built: the rules and scope are undecided (C-16, CR-1). Sign-ins are not attendance |
| Calls and call minutes in Performance | Shown as "—" until the client confirms what counts as a call (C-19) |
| Overdue on a booking | Not shown: the figure is understated until C-27 is decided |
| Cancelling a paid or confirmed booking | Refused; the rule waits on Q-B3 |
| Sold unit status | Not reachable yet (Q-B4) |
| Meta, TikTok and WhatsApp | Excluded. External ID stays blank |
| Staff leave approval | Needs its approvers set first |

## If something goes wrong

- **A page shows "Something went wrong":** press **Try again**. No saved work is lost.
- **No unit to book:** add one through Inventory.
- **Signed out:** sign in again; each person's project is remembered on that browser.
- **Slow page:** check you started the production build, not the dev server.
