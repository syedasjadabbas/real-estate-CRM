# In-app notifications (FR-006) — implementation notes

Status: **built and tested, 31 Oct 2026.** Follow-up reminders are **off** until an admin sets the reminder window, because the threshold is not documented (see §5).

Sources:
- `REQUIREMENTS.md` FR-006
- `MODULES_AND_FEATURES.md` (bell with unread count; "FOLLOW-UP SOON · lead · time · VIEW / ALL" pop-up)
- `USER_FLOWS.md` §1 ("Notify owner") and §3 (lost request: notify the manager; on rejection notify the agent)
- `DATA_MODEL.md` "notifications"
- `API_DESIGN.md` "Approvals and notifications"
- `SYSTEM_ARCHITECTURE.md` (database table plus 30–60 s polling)
- the reference's observed "Assigned to you" pop-up

## 1. Events and recipients (only documented ones)

| Event | Raised when | Recipient | Basis |
|---|---|---|---|
| `lead_assigned` | A lead is created with an owner, or reassigned | The new owner, unless they did it themselves | USER_FLOWS §1 "Notify owner"; observed "Assigned to you" |
| `lead_regenerated` | An existing lead receives a re-inquiry | The lead's owner, unless they did it | USER_FLOWS §1 (G → Notify owner) |
| `lost_requested` | An agent requests "Lost" | Managers of the active teams the lead owner belongs to | USER_FLOWS §3 (S→M approval item + notification) |
| `lost_rejected` | A manager or admin rejects the request | The requester | USER_FLOWS §3 (Reject → notify) |
| `follow_up_soon` | A pending follow-up is due within the reminder window | The follow-up's assignee | FR-006 |

Not raised:
- **Approval of a lost request.** The flow documents a notification on rejection only.
- **Anything else:** meetings, tasks, bookings, finance, HR. There is no requirement for them.

## 2. Behaviour

- **Storage:** `notifications` table (migration `0012_notifications`, additive): user, type, title, body, link, event key, read time, created time.
- **No duplicates:** a unique index on (user, event key) prevents them, so retries, concurrent requests and repeated polls never notify twice.
- **No self-notifications:** the person who acts is never notified.
- **Same transaction:** each event is written inside the transaction of the action that causes it, so a failed action leaves no notification.
- **Links:** always an internal `/dashboard/…` path (a database check enforces this), pointing to the lead. Recipients already have access to that lead under the lead rules (owner, owner's manager, admins).
- **Reminders without a scheduler:** each time a user's notifications are read, that user's pending follow-ups due within the window are checked. The event key includes the due time, so polling never repeats a reminder, while a rescheduled follow-up reminds again. Completed or cancelled follow-ups do not remind.
- **Header bell** (every role):
  - unread count (99+ cap);
  - latest 10 notifications;
  - opening one marks it read and goes to the lead;
  - "Mark all read" and "View all";
  - polls every 45 s and when the window regains focus.
- **Pop-up:** "Follow-up soon" with **View** and **All**, shown once per browser session for each reminder.
- **History page:** `/dashboard/notifications`, with All / Unread tabs, pagination and "Mark all read".
- **API:**
  - `GET /api/v1/notifications?unread=1&page=`
  - `POST /api/v1/notifications/read-all`
  - `POST /api/v1/notifications/:id/read`

  Everyone sees only their own notifications; another user's id returns 404.
- **Reminder window:**
  - `notifications.follow_up_reminder_minutes` in `app_settings`, 1–1,440 minutes; blank means off.
  - Set on the notifications page by super admins and admins only, and audited as `app.setting`.

## 3. Permissions

| Action | Super admin | Admin | Manager | Agent | HR | Accountant |
|---|---|---|---|---|---|---|
| Read and mark own notifications | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Read anyone else's | — | — | — | — | — | — |
| Set the reminder window | ✓ | ✓ | — | — | — | — |

## 4. Tests

`tests/integration/notifications.test.ts` (8):
- assignment, including no self-notification and reassignment;
- re-inquiry;
- a lost request goes to the team manager and not to admins;
- rejection notifies the requester, approval does not;
- no notification when the team has no manager;
- reminders: off by default; on at 30 min; repeated polls give one reminder; rescheduling reminds again; completed follow-ups don't remind;
- setting permissions, validation and audit;
- own-only reading, unread counts, mark one and mark all, another user's id returns 404;
- duplicate and external-link rows are refused by the database.

## 5. Open questions for the client

| # | Question | Current handling |
|---|---|---|
| N1 | How long before a follow-up is due should the reminder and pop-up appear? | Off until an admin sets a window |
| N2 | Who receives a lost request when the owner's team has no manager (or the owner is in no team)? Admins? | Nobody is notified; the request still appears in Approvals for admins |
| N3 | Should the agent also be notified when a lost request is **approved**? | Not notified (rejection only, as documented) |
| N4 | Are other events wanted (meetings, tasks, booking stage changes, payment reversals, leave)? | None until specified |
| N5 | Should notifications ever be deleted or expire? | Kept; no deletion |
| N6 | Email or push notifications? | In-app only (email waits on Q-T2) |

## 6. Review (31 Oct 2026, round 3)

| Check | Result | Evidence |
|---|---|---|
| No duplicates | The unique (user, event key) index plus `onConflictDoNothing`; repeated polls give one reminder; replayed inserts are refused | `notifications.test.ts`; `workflows.test.ts` checks that every stored (user, key) pair is unique after the full sales flow |
| No self-notifications | The acting user is filtered out in `notify` | Manager creating a lead, or taking one, is not notified; in the flow the manager receives only the lost request |
| Correct recipients | Owner (assignment, re-inquiry); the owner's active team managers (lost request); the requester (rejection); the assignee (reminder) | Integration and workflow tests; browser: agent 6 unread, manager 1 lost request, agent2 only their own assignment |
| Unread counts | Own unread only; Unread tab and bell agree | Tests; browser bell label "6 unread" → 5 after opening one |
| Mark one / mark all | Mark one returns 404 for anyone else's id; mark all touches only the user's own rows | Tests (`markRead` of another user's id → NOT_FOUND; the manager's count is unchanged after the agent's mark-all) |
| Reminder window | Off by default; 1–1,440 minutes; super admin and admin only; audited; due time inside the window only; rescheduling reminds again; completed follow-ups never remind | Tests; browser: 0 rejected ("At least 1 minute"), 45 saved |
| Role privacy | The list API filters by the session user only; no parameter can select another user | Tests; browser for six roles (each sees only their own) |
| Phone layout | Fixed in round 2: the dropdown stays inside a 375 px screen | Browser |

Open rules (N1–N6, §5) are unchanged and still need the client.
