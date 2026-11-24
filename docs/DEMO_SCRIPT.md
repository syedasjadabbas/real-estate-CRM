# Leads demo script

About 30 minutes. All customers are made up. Their numbers may not be real, so **don't call or message them**; the WhatsApp step uses your own second number.

## Before the demo

1. Refresh the dates, so "overdue", "today" and "tomorrow" are right:
   `node --experimental-transform-types --no-warnings scripts/demo/demo-data.mjs`
2. Sign in as **Dev Agent One** in one browser and **Dev Super Admin** in another. Choose **Demo Project 1** as the active project in both.
3. Keep ready: a second phone with WhatsApp, WhatsApp open on this computer, and [campaign-4-live.csv](demo/campaign-4-live.csv).

## Agent

| # | Show | Do this | What they should see |
|---|---|---|---|
| 1 | Leads table | Open Leads | Project on every lead, time in stage, Last Contact, and Overdue / Due today / Upcoming follow-ups |
| 2 | Views | Open New, Meetings, Booking, Stagnating, Repeat enquiries | **Waqas Ahmed** is first in Stagnating |
| 3 | Contact details | View contact on **Sana Malik** | Call, WhatsApp, Copy Number, Copy Email |
| 4 | Log Activity: call | Log Activity on **Fahad Sheikh**: Call, Talked, add a note, tick the pending follow-up it fulfils, schedule the next one, save | Nothing is ticked beforehand, even overdue. The ticked follow-up is completed, new one scheduled, stage and Last Contact updated in one save |
| 5 | Complete only | Log Activity → Note on **Imran Baig**: tick the follow-up, untick Schedule, save | Follow-up completed, nothing new scheduled |
| 6 | No contact logged | Find **Ghazala Parveen** (Booking in Process) and **Omar Farooq** | Ghazala went straight to a booking: "No contact logged", as a booking isn't contact. Omar has a contact date from a real meeting |
| 7 | Log Activity: meeting | On **Hira Nawaz**, log a meeting that wasn't scheduled; on **Tariq Mehmood**, choose Rescheduled. Show **Saima Javed** (done) | Held: meeting record, Meeting Done and Last Contact, all in one save. Rescheduled: the meeting moves. A no-show isn't contact |
| 8 | Booking | Open **Omar Farooq**, then **Kiran Shah** | One booking in process; one Closed Won with proofs and payment |

## Repeat enquiries

| # | Show | Do this | What they should see |
|---|---|---|---|
| 9 | Same project again | Open **Bushra Aslam** → Enquiry history | Three enquiries on one lead: date, channel, agent, notes. No second lead |
| 10 | Record one live | Record repeat enquiry on **Hamid Raza**, choose Other and type a channel | Added to the history; the table shows Repeat enquiry |
| 11 | Other projects | Open **Shahid Latif**, point at "+2 projects", then open the client | One client, three leads in three projects, all enquiries together |
| 12 | Same number, Add lead | As the agent, Add lead with `3000002015` in Demo Project 1 | Told the customer exists; only a repeat enquiry can be recorded |
| 13 | Lost lead enquires | Notifications → Unread → **Zainab Hussain** | "This lead is Lost: decide whether to reopen it" |
| 14 | Reopen | **Reopen lead** on Zainab, say why, save | Back to Qualified Lead; the timeline says "Lead reopened" |
| 15 | Already reopened | Open **Faisal Rehman** | Full story: contacted, lost, walked in, reopened |
| 16 | Booked customer | Open **Kiran Shah** → Enquiry history | Recorded only; the booking isn't touched |

## WhatsApp (your own account)

1. Super Admin: Add lead with **your second number**, owner Dev Agent One.
2. Agent: View contact → WhatsApp. Show which account opens. Send a message and reply from the other phone.
3. Back in the CRM, Last Contact is still empty: **the click isn't contact**.
4. Take a screenshot. Log Activity → WhatsApp, add it and save.
5. Last Contact is now set and the upload is on the timeline. **Imran Baig** has a finished example.

Say plainly: it is click-to-chat, not an integration. The CRM doesn't read the conversation. Delete the lead's real number from anything you share afterwards.

## Super Admin

| # | Show | Do this | What they should see |
|---|---|---|---|
| 17 | Verification | Approve **Mehwish Tariq**; show **Danish Ali** (rejected with a reason) | The agent can work on a lead only once approved |
| 18 | Lost request | Decide **Junaid Akram**'s request | Agents ask; an Admin or Super Admin decides |
| 19 | Own leads only | Find **Usama Ghani** (Agent Two) as Super Admin, then search as Agent One | Agent One can't see it |
| 20 | Campaign import | Import **campaign-4-live.csv** into **Demo Project 3**, show the checks, approve | 14 new leads, shared between the agents. One repeated number and one wrong number refused, with the reason. "1 kanal house" read as House, 4,500 sq ft. "big one" kept and flagged. Ahmed Awan, already a client from another project, gets another lead with the same agent |
| 21 | Size | Leads → Filters: size 4,400 to 4,600 in Demo Project 2 | 1 kanal and 20 marla together. Open one: **Matching units** lists the 4,500 sq ft houses |
| 22 | Campaign | Filters → Campaign: Nov Houses Launch | Only that campaign's leads |
| 23 | Start to finish | Open **Moiz Awan** (Demo Project 2) → Timeline and Open full audit | Imported from the campaign, assigned, called, met, booked a 1 kanal house, Closed Won |
| 24 | Marla | Projects → Demo Project 4 | 250 sq ft a marla, so 1 kanal is 5,000 sq ft there |

## If asked

- **Facebook:** agents have no Facebook functionality; it is only a lead source. Automatic capture is reviewed with Super Admin.
- **Desired size:** campaign forms use the same choices as the CRM (property type, then 3, 5, 7 or 10 marla, 1 or 2 kanal, or Other / not sure). Free text is read when it is clear and flagged when it isn't. A marla is set per project.
- **Email:** the Email button opens a new message in Gmail.
- **Names like "Dev Agent One":** test accounts.

Steps 4, 5, 7, 10, 14, 17, 18 and 20 change the data. Running the script again only refreshes dates; it does not undo them. Rehearse with other leads.
