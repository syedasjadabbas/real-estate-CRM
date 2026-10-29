import { and, asc, count, desc, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/server/db";
import { leads, meetingHistory, meetings, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { forbidden } from "@/server/errors";
import { canAccessLead } from "@/modules/leads/policy";
import { scopeFilter as leadScopeFilter, teamMemberIds, type DbOrTx } from "@/modules/leads/support";
import { MEETING_PAGE_SIZE } from "./constants";
import { loadAccessibleMeeting } from "./commands";
import { ORGANIZER_ROLES, canAccessMeeting, canDoMeeting, meetingScope } from "./policy";
import { meetingListQuerySchema } from "./validation";

const organizer = alias(users, "organizer");
const actorUser = alias(users, "history_actor");

function meetingScopeFilter(actor: Actor, members: string[]): SQL {
  switch (meetingScope(actor.role)) {
    case "all":
      return sql`true`;
    case "team": {
      const people = [actor.id, ...members];
      return or(inArray(meetings.organizerId, people), inArray(meetings.createdById, people))!;
    }
    case "own":
      return or(eq(meetings.organizerId, actor.id), eq(meetings.createdById, actor.id))!;
    default:
      throw forbidden();
  }
}

/** Overdue (FR-027, assumption M-A7): still Scheduled and the start time has passed. */
export const overdueCondition = (now: Date) => and(eq(meetings.status, "scheduled"), lt(meetings.startsAt, now))!;
export const isOverdue = (m: { status: string; startsAt: Date }, now: Date) => m.status === "scheduled" && m.startsAt < now;

const SORTS = {
  title: sql`lower(${meetings.title})`,
  startsAt: meetings.startsAt,
  organizer: sql`lower(${organizer.name})`,
  lead: sql`lower(${leads.name})`,
  status: meetings.status,
  updatedAt: meetings.updatedAt,
};

export type MeetingListRow = Awaited<ReturnType<typeof listMeetings>>["rows"][number];

/** FR-102 list: search (title, lead name / code), status, organizer, lead, overdue; sortable; pages. */
export async function listMeetings(db: Database, actor: Actor, rawQuery: unknown, now = new Date()) {
  if (!canDoMeeting(actor, "view")) throw forbidden();
  const query = meetingListQuerySchema.parse(rawQuery ?? {});
  const members = await teamMemberIds(db, actor);
  const term = query.q ? `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const where = and(
    meetingScopeFilter(actor, members),
    query.status ? eq(meetings.status, query.status) : undefined,
    query.organizer ? eq(meetings.organizerId, query.organizer === "me" ? actor.id : query.organizer) : undefined,
    query.lead ? eq(meetings.leadId, query.lead) : undefined,
    query.overdue ? overdueCondition(now) : undefined,
    term ? or(ilike(meetings.title, term), ilike(leads.name, term), ilike(leads.code, term)) : undefined,
  );
  const [{ total }] = await db.select({ total: count() }).from(meetings).innerJoin(leads, eq(leads.id, meetings.leadId)).where(where);
  const pageCount = Math.max(1, Math.ceil(total / MEETING_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  const column = SORTS[query.sort];
  const order = query.dir === "asc" ? sql`${column} asc nulls last` : sql`${column} desc nulls last`;
  const rows = await db
    .select({
      id: meetings.id,
      title: meetings.title,
      startsAt: meetings.startsAt,
      endsAt: meetings.endsAt,
      status: meetings.status,
      updatedAt: meetings.updatedAt,
      organizerName: organizer.name,
      leadId: leads.id,
      leadName: leads.name,
      leadCode: leads.code,
      leadOwnerId: leads.ownerId,
    })
    .from(meetings)
    .innerJoin(organizer, eq(organizer.id, meetings.organizerId))
    .innerJoin(leads, eq(leads.id, meetings.leadId))
    .where(where)
    .orderBy(order, desc(meetings.id))
    .limit(MEETING_PAGE_SIZE)
    .offset((page - 1) * MEETING_PAGE_SIZE);
  return {
    query: { ...query, page },
    total,
    page,
    pageCount,
    pageSize: MEETING_PAGE_SIZE,
    // A lead outside the actor's lead scope is not named (no lead data leak through meetings).
    rows: rows.map(({ leadOwnerId, ...r }) => {
      const visible = canAccessLead(actor, leadOwnerId, members);
      return { ...r, leadId: visible ? r.leadId : null, leadName: visible ? r.leadName : null, leadCode: visible ? r.leadCode : null, overdue: isOverdue(r, now) };
    }),
  };
}

/** Organizers the actor may pick: anyone (admins), self + team (managers), self (agents). */
export async function organizerOptions(db: DbOrTx, actor: Actor) {
  const members = await teamMemberIds(db, actor);
  const scope = meetingScope(actor.role);
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(
      and(
        eq(users.status, "active"),
        inArray(users.role, ORGANIZER_ROLES),
        scope === "all" ? undefined : inArray(users.id, scope === "team" ? [actor.id, ...members] : [actor.id]),
      ),
    )
    .orderBy(asc(users.name));
}

/** Create / edit form options: organizers, and leads in the header project plus the linked one (M-A9). */
export async function meetingFormOptions(db: Database, actor: Actor, projectId: string | null, currentLeadId: string | null = null) {
  if (!canDoMeeting(actor, "create")) throw forbidden();
  const members = await teamMemberIds(db, actor);
  const [organizers, leadRows] = await Promise.all([
    organizerOptions(db, actor),
    db
      .select({ id: leads.id, name: leads.name, code: leads.code, stage: leads.stage })
      .from(leads)
      .where(
        and(
          isNull(leads.deletedAt),
          leadScopeFilter(actor, members),
          or(projectId ? eq(leads.projectId, projectId) : undefined, currentLeadId ? eq(leads.id, currentLeadId) : undefined),
        ),
      )
      .orderBy(asc(leads.name))
      .limit(1000),
  ]);
  return { organizers, leads: leadRows };
}
export type MeetingFormOptions = Awaited<ReturnType<typeof meetingFormOptions>>;

/** Detail with organizer / creator names, the lead (when the actor may open it) and the history. */
export async function getMeetingDetail(db: Database, actor: Actor, meetingId: string, now = new Date()) {
  if (!canDoMeeting(actor, "view")) throw forbidden();
  const { meeting, members } = await loadAccessibleMeeting(db, actor, meetingId);
  const [people, [lead], history] = await Promise.all([
    db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [meeting.organizerId, ...(meeting.createdById ? [meeting.createdById] : [])])),
    db.select({ id: leads.id, name: leads.name, code: leads.code, stage: leads.stage, ownerId: leads.ownerId }).from(leads).where(eq(leads.id, meeting.leadId)),
    db
      .select({ id: meetingHistory.id, action: meetingHistory.action, data: meetingHistory.data, createdAt: meetingHistory.createdAt, actorName: actorUser.name })
      .from(meetingHistory)
      .leftJoin(actorUser, eq(actorUser.id, meetingHistory.actorId))
      .where(eq(meetingHistory.meetingId, meeting.id))
      .orderBy(desc(meetingHistory.createdAt), desc(meetingHistory.id)),
  ]);
  const organizerIds = [...new Set(history.flatMap((h) => (h.action === "organizer" ? [h.data?.from, h.data?.to] : [])).filter((v): v is string => typeof v === "string"))];
  const organizerNames = organizerIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, organizerIds)) : [];
  const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
  const leadVisible = lead ? canAccessLead(actor, lead.ownerId, members) : false;
  return {
    meeting,
    organizerName: name(meeting.organizerId),
    creatorName: name(meeting.createdById),
    overdue: isOverdue(meeting, now),
    lead: lead && leadVisible ? { id: lead.id, name: lead.name, code: lead.code, stage: lead.stage } : null,
    history,
    userNames: Object.fromEntries(organizerNames.map((u) => [u.id, u.name])) as Record<string, string>,
    canEdit: canDoMeeting(actor, "edit") && canAccessMeeting(actor, meeting, members),
  };
}
export type MeetingDetail = Awaited<ReturnType<typeof getMeetingDetail>>;

/** FR-027 overdue meetings for To-dos, in the actor's scope (oldest first). */
export async function overdueMeetings(db: Database, actor: Actor, now = new Date(), limit = 200) {
  if (!canDoMeeting(actor, "view")) return { count: 0, rows: [] };
  const members = await teamMemberIds(db, actor);
  const where = and(meetingScopeFilter(actor, members), overdueCondition(now));
  const [[{ n }], rows] = await Promise.all([
    db.select({ n: count() }).from(meetings).where(where),
    db
      .select({ id: meetings.id, title: meetings.title, startsAt: meetings.startsAt, organizerName: organizer.name })
      .from(meetings)
      .innerJoin(organizer, eq(organizer.id, meetings.organizerId))
      .where(where)
      .orderBy(asc(meetings.startsAt))
      .limit(limit),
  ]);
  return { count: n, rows };
}

/** Meetings for one lead (lead page panel), within the actor's meetings scope. */
export async function meetingsForLead(db: Database, actor: Actor, leadId: string, now = new Date()) {
  if (!canDoMeeting(actor, "view")) return [];
  return (await listMeetings(db, actor, { lead: leadId, sort: "startsAt", dir: "desc" }, now)).rows;
}
