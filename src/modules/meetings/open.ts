import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/server/db";
import { meetings } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { teamMemberIds } from "@/modules/leads/support";
import { canAccessMeeting, canDoMeeting } from "./policy";

export type OpenMeeting = { id: string; title: string; startsAt: Date | string; type: string | null; location: string | null };

/** The scheduled meetings on these leads that the actor may record an outcome for, soonest first. */
export async function openMeetings(db: Database, actor: Actor, leadIds: string[]) {
  const out = new Map<string, OpenMeeting[]>();
  if (leadIds.length === 0 || !canDoMeeting(actor, "edit")) return out;
  const [members, rows] = await Promise.all([
    teamMemberIds(db, actor),
    db
      .select({ id: meetings.id, leadId: meetings.leadId, title: meetings.title, startsAt: meetings.startsAt, type: meetings.type, location: meetings.location, organizerId: meetings.organizerId, createdById: meetings.createdById })
      .from(meetings)
      .where(and(inArray(meetings.leadId, leadIds), eq(meetings.status, "scheduled")))
      .orderBy(asc(meetings.startsAt)),
  ]);
  for (const m of rows) {
    if (canAccessMeeting(actor, m, members)) out.set(m.leadId, [...(out.get(m.leadId) ?? []), { id: m.id, title: m.title, startsAt: m.startsAt, type: m.type, location: m.location }]);
  }
  return out;
}
