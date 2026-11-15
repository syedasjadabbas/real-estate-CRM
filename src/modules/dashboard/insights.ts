import { and, count, eq, gte, inArray, lt, ne, sql, type SQL } from "drizzle-orm";
import type { AgingRow, MeetingFormat } from "@/features/dashboard/types";
import { MEETING_TYPE_LABELS, MEETING_TYPES } from "@/modules/meetings/constants";
import type { Database } from "@/server/db";
import { bookings, leads, meetings, teamMembers } from "@/server/db/schema";

/**
 * Dashboard panels that were left empty (filled 15 Nov 2026). Every figure follows the same lead
 * scope and project as the rest of the dashboard (`leadWhere`), so an agent, a team filter and the
 * active project all narrow them alike.
 *
 * - Meeting mix: meetings that weren't cancelled, by format, that started in the window.
 * - Meetings vs bookings: per team, completed meetings and bookings (not cancelled) made in the
 *   selected range, counted under the team of the lead's owner.
 * - Aging vs meetings: open, engaged leads (touched at least once, so untouched imports are left
 *   out) by age, against how many completed meetings each has had.
 */

const DAY = 86_400_000;
export const MIX_RANGES = ["24h", "7d", "30d", "mtd", "6m"] as const;
export type MixRange = (typeof MIX_RANGES)[number];

/** Meeting counts by format for each compact range the Meetings Distribution card offers. */
export async function meetingMixes(db: Database, leadWhere: SQL | undefined, now: Date, monthStart: Date) {
  const sixMonths = new Date(now);
  sixMonths.setMonth(sixMonths.getMonth() - 6);
  const starts: Record<MixRange, Date> = {
    "24h": new Date(now.getTime() - DAY),
    "7d": new Date(now.getTime() - 7 * DAY),
    "30d": new Date(now.getTime() - 30 * DAY),
    mtd: monthStart,
    "6m": sixMonths,
  };
  const filters = Object.fromEntries(MIX_RANGES.map((r) => [r, sql<number>`count(*) filter (where ${meetings.startsAt} >= ${starts[r]})::int`])) as Record<MixRange, SQL<number>>;
  const rows = await db
    .select({ type: meetings.type, ...filters })
    .from(meetings)
    .innerJoin(leads, eq(leads.id, meetings.leadId))
    .where(and(leadWhere, ne(meetings.status, "cancelled"), gte(meetings.startsAt, sixMonths < monthStart ? sixMonths : monthStart), lt(meetings.startsAt, now)))
    .groupBy(meetings.type);
  const formats = [...MEETING_TYPES, null] as const;
  const mix = (r: MixRange): MeetingFormat[] =>
    formats
      .map((t) => ({
        id: t ?? "not_set",
        label: t ? MEETING_TYPE_LABELS[t] : "Format not set",
        count: rows.find((x) => x.type === t)?.[r] ?? 0,
        color: (t === "virtual" ? "sky" : "orange") as MeetingFormat["color"],
      }))
      .filter((f) => f.id !== "not_set" || f.count > 0);
  return Object.fromEntries(MIX_RANGES.map((r) => [r, mix(r)])) as Record<MixRange, MeetingFormat[]>;
}

/** Completed meetings and bookings per team in [start, end), busiest teams first. */
export async function teamOutput(db: Database, leadWhere: SQL | undefined, teamList: { id: string; name: string }[], start: Date, end: Date) {
  if (teamList.length === 0) return [];
  const ids = teamList.map((t) => t.id);
  const [met, booked] = await Promise.all([
    db
      .select({ teamId: teamMembers.teamId, n: count() })
      .from(meetings)
      .innerJoin(leads, eq(leads.id, meetings.leadId))
      .innerJoin(teamMembers, eq(teamMembers.userId, leads.ownerId))
      .where(and(leadWhere, inArray(teamMembers.teamId, ids), eq(meetings.status, "completed"), gte(meetings.startsAt, start), lt(meetings.startsAt, end)))
      .groupBy(teamMembers.teamId),
    db
      .select({ teamId: teamMembers.teamId, n: count() })
      .from(bookings)
      .innerJoin(leads, eq(leads.id, bookings.leadId))
      .innerJoin(teamMembers, eq(teamMembers.userId, leads.ownerId))
      .where(and(leadWhere, inArray(teamMembers.teamId, ids), ne(bookings.stage, "cancelled"), gte(bookings.createdAt, start), lt(bookings.createdAt, end)))
      .groupBy(teamMembers.teamId),
  ]);
  const get = (rows: { teamId: string; n: number }[], id: string) => rows.find((r) => r.teamId === id)?.n ?? 0;
  return teamList
    .map((t) => ({ id: t.id, label: t.name, meetings: get(met, t.id), bookings: get(booked, t.id) }))
    .filter((t) => t.meetings || t.bookings)
    .sort((a, b) => b.bookings - a.bookings || b.meetings - a.meetings || a.label.localeCompare(b.label))
    .slice(0, 6);
}

/**
 * Completed meetings in the last 30 days and the last 6 months, and, for the Team meetings tile, those
 * in the dashboard's selected range [start, end) on leads owned by team members (15 Nov 2026).
 */
export async function meetingTotals(db: Database, leadWhere: SQL | undefined, now: Date, range: { start: Date; end: Date }) {
  const sixMonths = new Date(now);
  sixMonths.setMonth(sixMonths.getMonth() - 6);
  const thirty = new Date(now.getTime() - 30 * DAY);
  const from = range.start < sixMonths ? range.start : sixMonths;
  const [row] = await db
    .select({
      d30: sql<number>`count(*) filter (where ${meetings.startsAt} >= ${thirty} and ${meetings.startsAt} < ${now})::int`,
      m6: sql<number>`count(*) filter (where ${meetings.startsAt} >= ${sixMonths} and ${meetings.startsAt} < ${now})::int`,
      team: sql<number>`count(*) filter (where ${meetings.startsAt} >= ${range.start} and ${meetings.startsAt} < ${range.end} and exists (select 1 from ${teamMembers} tm where tm.user_id = "leads"."owner_id"))::int`,
    })
    .from(meetings)
    .innerJoin(leads, eq(leads.id, meetings.leadId))
    .where(and(leadWhere, eq(meetings.status, "completed"), gte(meetings.startsAt, from), lt(meetings.startsAt, now > range.end ? now : range.end)));
  return row;
}

const AGE_BANDS = [
  { label: "0–7 days", min: 0, max: 7 },
  { label: "8–30 days", min: 8, max: 30 },
  { label: "31–90 days", min: 31, max: 90 },
  { label: "91–180 days", min: 91, max: 180 },
  { label: "Over 180 days", min: 181, max: Infinity },
];
const bucketOf = (meetingsCount: number) => (meetingsCount <= 1 ? 0 : meetingsCount <= 5 ? 1 : meetingsCount <= 10 ? 2 : meetingsCount <= 20 ? 3 : 4);

/** Open, engaged leads by age band against their completed meetings (the Aging vs Meetings table). */
export async function agingRows(db: Database, openLeadWhere: SQL | undefined, now: Date): Promise<AgingRow[]> {
  const rows = await db
    .select({
      ownerId: leads.ownerId,
      ageDays: sql<number>`floor(extract(epoch from (${now}::timestamptz - ${leads.createdAt})) / 86400)::int`,
      meetings: sql<number>`(select count(*) from ${meetings} m where m.lead_id = "leads"."id" and m.status = 'completed')::int`,
    })
    .from(leads)
    .where(and(openLeadWhere, sql`${leads.firstTouchAt} is not null`));
  return AGE_BANDS.map((band) => {
    const inBand = rows.filter((r) => r.ageDays >= band.min && r.ageDays <= band.max);
    const buckets: AgingRow["buckets"] = [0, 0, 0, 0, 0];
    for (const r of inBand) buckets[bucketOf(r.meetings)]++;
    const owners = new Set(inBand.map((r) => r.ownerId ?? "none")).size;
    return { age: band.label, buckets, leads: inBand.length, meetings: inBand.reduce((n, r) => n + r.meetings, 0), avgPerOwner: owners ? Math.round(inBand.length / owners) : 0 };
  }).filter((r) => r.leads > 0);
}
