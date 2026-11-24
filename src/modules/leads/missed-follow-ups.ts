import { and, asc, eq, isNull, lt, notInArray } from "drizzle-orm";
import type { Database } from "@/server/db";
import { auditLogs, followUps, leadActivities, leads } from "@/server/db/schema";

// Kept free of the wider app graph so the scheduled job (scripts/jobs/mark-missed-follow-ups.mjs) can load it.

/**
 * A follow-up is missed when it is still pending at the end of its due day, Pakistan time (proposed to the
 * client, 24 Nov 2026). It is recorded once per due date, on the lead's timeline and in the audit log; it
 * stays pending, so the agent can still do it late, reschedule it or cancel it.
 */
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Midnight in Pakistan at the start of `now`'s day. */
export const startOfToday = (now: Date) => new Date(`${new Date(now.getTime() + 5 * 3_600_000).toISOString().slice(0, 10)}T00:00:00+05:00`);

/** Records it as missed when it is. Also run before a late follow-up is closed, so a miss is never lost between job runs. */
export async function recordMissed(tx: Tx, followUpId: string, now = new Date()) {
  const [row] = await tx
    .update(followUps)
    .set({ missedAt: now })
    .where(and(eq(followUps.id, followUpId), eq(followUps.status, "pending"), isNull(followUps.missedAt), lt(followUps.dueAt, startOfToday(now))))
    .returning({ leadId: followUps.leadId, dueAt: followUps.dueAt, note: followUps.note, assigneeId: followUps.assigneeId });
  if (!row) return false;
  const data = { followUpId, dueAt: row.dueAt.toISOString(), assigneeId: row.assigneeId };
  await tx.insert(leadActivities).values({ leadId: row.leadId, actorId: null, type: "follow_up_missed", body: row.note, data });
  await tx.insert(auditLogs).values({ actorId: null, ip: null, action: "lead.follow_up_missed", entity: "lead", entityId: row.leadId, before: null, after: data });
  return true;
}

/** Job body: one transaction each, safe to repeat and to overlap. Closed leads' follow-ups aren't missed. */
export async function markMissedFollowUps(db: Database, now = new Date()) {
  const due = await db
    .select({ id: followUps.id })
    .from(followUps)
    .innerJoin(leads, eq(leads.id, followUps.leadId))
    .where(and(eq(followUps.status, "pending"), isNull(followUps.missedAt), lt(followUps.dueAt, startOfToday(now)), isNull(leads.deletedAt), notInArray(leads.stage, ["lost_lead", "booked"])))
    .orderBy(asc(followUps.dueAt))
    .limit(5000);
  let marked = 0;
  for (const f of due) if (await db.transaction((tx) => recordMissed(tx, f.id, now))) marked += 1;
  return { marked };
}
