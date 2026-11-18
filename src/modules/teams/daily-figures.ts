import { and, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { CALL_KINDS } from "@/modules/performance/calls";
import type { Database } from "@/server/db";
import { bookings, files, leadActivities, leads, meetings } from "@/server/db/schema";
import { addDays } from "./dates";

/**
 * The CRM's own figures for an agent's day (owner, 15 Nov 2026), used to fill the Daily Report so
 * nobody retypes them. One business day in Pakistan time:
 * - Leads: leads that became theirs that day (created for them, or assigned / claimed to them).
 * - Calls: call recordings they uploaded (one recording = one call, as everywhere in the CRM).
 * - Meetings: meetings they organised that were completed, by meeting date.
 * - Tokens: bookings they opened (the token stage), not cancelled.
 * - Bookings: their bookings closed as won (confirmed) that day.
 */
export type DayFigures = { leads: number; calls: number; meetings: number; tokens: number; bookings: number };
export const NO_FIGURES: DayFigures = { leads: 0, calls: 0, meetings: 0, tokens: 0, bookings: 0 };

export async function crmDayFigures(db: Database, agentIds: string[], date: string) {
  const out = new Map<string, DayFigures>();
  if (agentIds.length === 0) return out;
  const from = new Date(`${date}T00:00:00+05:00`);
  const to = new Date(`${addDays(date, 1)}T00:00:00+05:00`);
  const [leadRows, callRows, meetingRows, tokenRows, bookingRows] = await Promise.all([
    db
      .select({ id: leads.ownerId, n: sql<number>`count(distinct ${leads.id})::int` })
      .from(leads)
      .where(
        and(
          inArray(leads.ownerId, agentIds),
          isNull(leads.deletedAt),
          or(
            and(gte(leads.createdAt, from), lt(leads.createdAt, to)),
            sql`exists (select 1 from ${leadActivities} a where a.lead_id = "leads"."id" and a.type = 'assignment' and a.data->>'ownerId' = "leads"."owner_id"::text and a.created_at >= ${from} and a.created_at < ${to})`,
          ),
        ),
      )
      .groupBy(leads.ownerId),
    db
      .select({ id: files.uploadedById, n: sql<number>`count(*)::int` })
      .from(files)
      .where(and(inArray(files.uploadedById, agentIds), inArray(files.kind, [...CALL_KINDS]), isNull(files.deletedAt), gte(files.createdAt, from), lt(files.createdAt, to)))
      .groupBy(files.uploadedById),
    db
      .select({ id: meetings.organizerId, n: sql<number>`count(*)::int` })
      .from(meetings)
      .where(and(inArray(meetings.organizerId, agentIds), eq(meetings.status, "completed"), gte(meetings.startsAt, from), lt(meetings.startsAt, to)))
      .groupBy(meetings.organizerId),
    db
      .select({ id: bookings.agentId, n: sql<number>`count(*)::int` })
      .from(bookings)
      .where(and(inArray(bookings.agentId, agentIds), ne(bookings.stage, "cancelled"), gte(bookings.createdAt, from), lt(bookings.createdAt, to)))
      .groupBy(bookings.agentId),
    db
      .select({ id: bookings.agentId, n: sql<number>`count(*)::int` })
      .from(bookings)
      .where(and(inArray(bookings.agentId, agentIds), eq(bookings.stage, "confirmed"), gte(bookings.stageChangedAt, from), lt(bookings.stageChangedAt, to)))
      .groupBy(bookings.agentId),
  ]);
  const get = (rows: { id: string | null; n: number }[], id: string) => rows.find((r) => r.id === id)?.n ?? 0;
  for (const id of agentIds) {
    out.set(id, { leads: get(leadRows, id), calls: get(callRows, id), meetings: get(meetingRows, id), tokens: get(tokenRows, id), bookings: get(bookingRows, id) });
  }
  return out;
}
