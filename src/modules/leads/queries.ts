import { OTHER_CITY } from "@/modules/cities/constants";
import { canVerifyLeads } from "./verification";
import { and, asc, count, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/server/db";
import {
  approvals,
  budgetRanges,
  cities,
  followUps,
  leadActivities,
  leadFavorites,
  leadReviews,
  leadSources,
  leads,
  lostReasons,
  projects,
  teamMembers,
  teams,
  users,
  leadPhones,
  units,
} from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { forbidden } from "@/server/errors";
import { BUSINESS_TIME_ZONE, LEAD_STAGES, PAGE_SIZE, UNATTENDED_HOURS, type LeadStage } from "./constants";
import { formatPhone } from "./phone";
import { leadPhonesOf } from "@/modules/contacts/phones";
import { canAccessLead, canDo, leadScope } from "./policy";
import { followUpLeadActive, hasOpenBooking, loadAccessibleLead, pageWithin, scopeFilter, teamMemberIds } from "./support";
import { leadListQuerySchema, type LeadListQuery } from "./validation";

const owner = alias(users, "owner");
const original = alias(leads, "original");

function baseConditions(actor: Actor, members: string[], projectId: string): SQL[] {
  return [isNull(leads.deletedAt), eq(leads.projectId, projectId), scopeFilter(actor, members)];
}

function searchCondition(q: string | undefined): SQL | undefined {
  if (!q) return undefined;
  const term = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const digits = q.replace(/\D/g, "").replace(/^0+/, "");
  const parts: SQL[] = [ilike(leads.name, term), ilike(leads.email, term), ilike(leads.code, term)];
  if (digits.length >= 3) {
    parts.push(ilike(leads.phoneE164, `%${digits}%`));
    // Every number a lead holds is searchable, not only the first.
    parts.push(sql`exists (select 1 from ${leadPhones} lp where lp.lead_id = ${leads.id} and lp.e164 like ${`%${digits}%`})`);
  }
  if (/^[0-9a-f-]{36}$/i.test(q)) parts.push(eq(leads.id, q));
  return or(...parts);
}

function dayExpr(column: typeof leads.createdAt | typeof leads.updatedAt | typeof leads.stageChangedAt) {
  return sql`(${column} at time zone ${BUSINESS_TIME_ZONE})::date`;
}

/** Filter conditions shared by the list, Kanban board and sub-views. */
function filterConditions(query: LeadListQuery, now: Date): SQL[] {
  const out: SQL[] = [];
  const search = searchCondition(query.q);
  if (search) out.push(search);
  if (query.stage.length) out.push(inArray(leads.stage, query.stage));
  if (query.source.length) out.push(inArray(leads.sourceId, query.source));
  if (query.city.length) {
    const ids = query.city.filter((c) => c !== OTHER_CITY);
    const city = or(ids.length ? inArray(leads.cityId, ids) : undefined, query.city.includes(OTHER_CITY) ? isNotNull(leads.cityOther) : undefined);
    if (city) out.push(city);
  }
  if (query.lostReason.length) out.push(inArray(leads.lostReasonId, query.lostReason));
  if (query.priority.length) out.push(inArray(leads.priority, query.priority));
  if (query.owner) out.push(eq(leads.ownerId, query.owner));
  if (query.followUp) {
    // The follow-up window describes pending work, so Lost leads are not in it (F-2).
    out.push(followUpLeadActive());
    const day = 24 * 60 * 60 * 1000;
    const inDays = (n: number) => new Date(now.getTime() + n * day);
    const f = leads.nextFollowUpAt;
    if (query.followUp === "overdue") out.push(lt(f, now));
    if (query.followUp === "1d") out.push(and(gte(f, now), lte(f, inDays(1)))!);
    if (query.followUp === "2d") out.push(and(gte(f, now), lte(f, inDays(2)))!);
    if (query.followUp === "after2d") out.push(gt(f, inDays(2)));
  }
  const dateCol = query.dateField === "updated" ? leads.updatedAt : query.dateField === "decided" ? leads.stageChangedAt : leads.createdAt;
  if (query.period) {
    // This month / this quarter, by the Pakistan calendar.
    const start = sql`date_trunc(${query.period}, (${now}::timestamptz at time zone ${BUSINESS_TIME_ZONE}))::date`;
    out.push(sql`${dayExpr(dateCol)} >= ${start}`);
    out.push(sql`${dayExpr(dateCol)} <= (${now}::timestamptz at time zone ${BUSINESS_TIME_ZONE})::date`);
  } else {
    if (query.from) out.push(sql`${dayExpr(dateCol)} >= ${query.from}::date`);
    if (query.to) out.push(sql`${dayExpr(dateCol)} <= ${query.to}::date`);
  }
  if (query.createdFrom) out.push(gte(leads.createdAt, new Date(query.createdFrom)));
  if (query.createdTo) out.push(lt(leads.createdAt, new Date(query.createdTo)));
  return out;
}

/**
 * The dashboard's team filter on a list: leads owned by the team's members. Like the dashboard, a
 * team the actor can't filter by is ignored; lead scope still applies on top either way.
 */
async function teamFilter(db: Database, actor: Actor, teamId: string | undefined) {
  const scope = leadScope(actor.role);
  if (!teamId || (scope !== "all" && !(scope === "team" && actor.managedTeamIds.includes(teamId)))) return { condition: undefined, teamName: null };
  const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) return { condition: undefined, teamName: null };
  const owners = (await db.select({ id: teamMembers.userId }).from(teamMembers).where(eq(teamMembers.teamId, teamId))).map((r) => r.id);
  return { condition: owners.length ? inArray(leads.ownerId, owners) : sql`false`, teamName: team.name };
}

function viewConditions(query: LeadListQuery): SQL[] {
  switch (query.view) {
    case "won":
      return [eq(leads.stage, "booked")];
    case "lost":
      return [eq(leads.stage, "lost_lead")];
    case "regenerated":
      return [eq(leads.isRegenerated, true)];
    case "duplicates":
      return [isNotNull(leads.duplicateOfId)];
    case "favorites":
      return [isNotNull(leadFavorites.leadId)];
    default:
      return [];
  }
}

/** The list city's name, or the name typed under "Other". */
const cityLabel = sql<string | null>`coalesce(${cities.name}, ${leads.cityOther})`;

/**
 * Priority order shared by every lead list and the board: High, Medium, Low, then ordinary leads.
 * Used whenever no column sort was chosen.
 */
export const priorityRank = sql<number>`case ${leads.priority} when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end`;

const sortColumns = {
  name: leads.name,
  phone: leads.phoneE164,
  city: cityLabel,
  owner: owner.name,
  createdAt: leads.createdAt,
  stage: leads.stage,
  source: leadSources.name,
  budget: budgetRanges.sortOrder,
  project: projects.name,
  priority: leads.priority,
  code: leads.code,
  // Longest in stage last when ascending, matching the duration shown.
  inStage: sql`now() - ${leads.stageChangedAt}`,
  modified: leads.updatedAt,
  firstTouch: sql`${leads.firstTouchAt} - ${leads.createdAt}`,
  next: leads.nextFollowUpAt,
  inbound: sql`${leads.inboundChannel}::text`,
  // Size is free text ("1,200 sq ft"), so it sorts by its number; text with no number goes last.
  size: sql`substring(replace(${leads.desiredSize}, ',', '') from '[0-9]+(?:\.[0-9]+)?')::numeric`,
  gender: sql`lower(${leads.gender})`,
  comment: sql`lower(${leads.latestComment})`,
  lostReason: lostReasons.name,
  externalId: leads.externalId,
} as const;

const listSelection = {
  id: leads.id,
  code: leads.code,
  name: leads.name,
  phoneCountryCode: leads.phoneCountryCode,
  phoneNumber: leads.phoneNumber,
  email: leads.email,
  stage: leads.stage,
  verification: leads.verification,
  stageChangedAt: leads.stageChangedAt,
  createdAt: leads.createdAt,
  updatedAt: leads.updatedAt,
  firstTouchAt: leads.firstTouchAt,
  nextFollowUpAt: leads.nextFollowUpAt,
  priority: leads.priority,
  desiredSize: leads.desiredSize,
  latestComment: leads.latestComment,
  inboundChannel: leads.inboundChannel,
  gender: leads.gender,
  externalId: leads.externalId,
  lostReasonName: lostReasons.name,
  isRegenerated: leads.isRegenerated,
  regeneratedAt: leads.regeneratedAt,
  lastActivityAt: leads.lastActivityAt,
  duplicateOfId: leads.duplicateOfId,
  ownerId: leads.ownerId,
  ownerName: owner.name,
  cityName: cityLabel.as("city_name"),
  sourceName: leadSources.name,
  budgetName: budgetRanges.name,
  projectName: projects.name,
  originalCode: original.code,
  isFavorite: sql<boolean>`${leadFavorites.leadId} is not null`,
};

export type LeadListRow = Awaited<ReturnType<typeof listLeads>>["rows"][number];

export async function listLeads(db: Database, actor: Actor, projectId: string, rawQuery: unknown, now = new Date()) {
  if (!canDo(actor, "view")) throw forbidden();
  const query = leadListQuerySchema.parse(rawQuery ?? {});
  const members = await teamMemberIds(db, actor);
  const { condition: inTeam, teamName } = await teamFilter(db, actor, query.team);
  const where = and(...baseConditions(actor, members, projectId), ...filterConditions(query, now), ...viewConditions(query), inTeam);

  const sortColumn = sortColumns[query.sort ?? "createdAt"];
  const orderBy =
    query.view === "regenerated" && !query.sort
      ? [desc(sql`${leads.lastActivityAt} < ${leads.regeneratedAt}`), desc(leads.regeneratedAt)]
      : query.sort
        ? [query.dir === "asc" ? sql`${sortColumn} asc nulls last` : sql`${sortColumn} desc nulls last`, desc(leads.createdAt)]
        : [desc(priorityRank), desc(leads.createdAt)];

  const from = () =>
    db
      .select(listSelection)
      .from(leads)
      .leftJoin(owner, eq(owner.id, leads.ownerId))
      .leftJoin(cities, eq(cities.id, leads.cityId))
      .leftJoin(lostReasons, eq(lostReasons.id, leads.lostReasonId))
      .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
      .leftJoin(budgetRanges, eq(budgetRanges.id, leads.budgetRangeId))
      .leftJoin(projects, eq(projects.id, leads.projectId))
      .leftJoin(original, eq(original.id, leads.duplicateOfId))
      .leftJoin(leadFavorites, and(eq(leadFavorites.leadId, leads.id), eq(leadFavorites.userId, actor.id)));

  const [{ total }] = await db
    .select({ total: count() })
    .from(leads)
    .leftJoin(leadFavorites, and(eq(leadFavorites.leadId, leads.id), eq(leadFavorites.userId, actor.id)))
    .where(where);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  const rows = await from()
    .where(where)
    .orderBy(...orderBy)
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return {
    generatedAt: now.getTime(),
    query: { ...query, page },
    teamName,
    total,
    page,
    pageCount,
    pageSize: PAGE_SIZE,
    rows: rows.map((r) => ({ ...r, phone: formatPhone(r.phoneCountryCode, r.phoneNumber) })),
  };
}

/** Kanban board: per-stage counts plus the newest cards in each stage. */
export async function pipelineBoard(db: Database, actor: Actor, projectId: string, rawQuery: unknown, perStage = 25, now = new Date()) {
  if (!canDo(actor, "view")) throw forbidden();
  const query = leadListQuerySchema.parse(rawQuery ?? {});
  const members = await teamMemberIds(db, actor);
  const where = and(...baseConditions(actor, members, projectId), ...filterConditions(query, now));

  const counts = await db.select({ stage: leads.stage, total: count() }).from(leads).where(where).groupBy(leads.stage);
  const byStage = Object.fromEntries(counts.map((c) => [c.stage, c.total])) as Partial<Record<LeadStage, number>>;

  // Rank only ids in the subquery, then join back for the card fields.
  const ranked = db
    .select({
      id: leads.id,
      rank: sql<number>`row_number() over (partition by ${leads.stage} order by ${priorityRank} desc, ${leads.updatedAt} desc)`.as("rank"),
    })
    .from(leads)
    .leftJoin(leadFavorites, and(eq(leadFavorites.leadId, leads.id), eq(leadFavorites.userId, actor.id)))
    .where(where)
    .as("ranked");
  const cards = await db
    .select(listSelection)
    .from(leads)
    .innerJoin(ranked, eq(ranked.id, leads.id))
    .leftJoin(owner, eq(owner.id, leads.ownerId))
    .leftJoin(cities, eq(cities.id, leads.cityId))
      .leftJoin(lostReasons, eq(lostReasons.id, leads.lostReasonId))
    .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .leftJoin(budgetRanges, eq(budgetRanges.id, leads.budgetRangeId))
    .leftJoin(projects, eq(projects.id, leads.projectId))
    .leftJoin(original, eq(original.id, leads.duplicateOfId))
    .leftJoin(leadFavorites, and(eq(leadFavorites.leadId, leads.id), eq(leadFavorites.userId, actor.id)))
    .where(lte(ranked.rank, perStage))
    .orderBy(desc(priorityRank), desc(leads.updatedAt));

  return {
    generatedAt: now.getTime(),
    total: counts.reduce((sum, c) => sum + c.total, 0),
    columns: LEAD_STAGES.map((stage) => ({
      stage,
      total: byStage[stage] ?? 0,
      cards: cards
        .filter((c) => c.stage === stage)
        .map((c) => ({ ...c, phone: formatPhone(c.phoneCountryCode, c.phoneNumber) })),
    })),
  };
}

export async function getLeadDetail(db: Database, actor: Actor, leadId: string) {
  if (!canDo(actor, "view")) throw forbidden();
  const { lead } = await loadAccessibleLead(db, actor, leadId);
  const [row] = await db
    .select(listSelection)
    .from(leads)
    .leftJoin(owner, eq(owner.id, leads.ownerId))
    .leftJoin(cities, eq(cities.id, leads.cityId))
      .leftJoin(lostReasons, eq(lostReasons.id, leads.lostReasonId))
    .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .leftJoin(budgetRanges, eq(budgetRanges.id, leads.budgetRangeId))
    .leftJoin(projects, eq(projects.id, leads.projectId))
    .leftJoin(original, eq(original.id, leads.duplicateOfId))
    .leftJoin(leadFavorites, and(eq(leadFavorites.leadId, leads.id), eq(leadFavorites.userId, actor.id)))
    .where(eq(leads.id, leadId));

  const actorUser = alias(users, "activity_actor");
  const [activities, followUpRows, pendingRequest, reviews, lostReason] = await Promise.all([
    db
      .select({
        id: leadActivities.id,
        type: leadActivities.type,
        body: leadActivities.body,
        data: leadActivities.data,
        createdAt: leadActivities.createdAt,
        actorName: actorUser.name,
      })
      .from(leadActivities)
      .leftJoin(actorUser, eq(actorUser.id, leadActivities.actorId))
      .where(eq(leadActivities.leadId, leadId))
      .orderBy(desc(leadActivities.createdAt)),
    db
      .select({
        id: followUps.id,
        dueAt: followUps.dueAt,
        note: followUps.note,
        status: followUps.status,
        doneAt: followUps.doneAt,
      })
      .from(followUps)
      .where(eq(followUps.leadId, leadId))
      .orderBy(asc(followUps.status), asc(followUps.dueAt)),
    db
      .select({ id: approvals.id, createdAt: approvals.createdAt, reason: lostReasons.name, note: approvals.note })
      .from(approvals)
      .leftJoin(lostReasons, eq(lostReasons.id, approvals.lostReasonId))
      .where(and(eq(approvals.leadId, leadId), eq(approvals.status, "pending")))
      .limit(1),
    db
      .select({ id: leadReviews.id, body: leadReviews.body, createdAt: leadReviews.createdAt, reviewerName: users.name })
      .from(leadReviews)
      .innerJoin(users, eq(users.id, leadReviews.reviewerId))
      .where(eq(leadReviews.leadId, leadId))
      .orderBy(desc(leadReviews.createdAt)),
    lead.lostReasonId
      ? db.select({ name: lostReasons.name }).from(lostReasons).where(eq(lostReasons.id, lead.lostReasonId))
      : Promise.resolve([]),
  ]);

  const closed = lead.stage === "lost_lead" || lead.stage === "booked";
  // An open booking must be cancelled before the lead can be lost (the server refuses it otherwise).
  const openBooking = !closed && (await hasOpenBooking(db, lead.id));
  // Lead verification: until an Admin or Super Admin approves an agent's lead, only they work on it;
  // a rejected lead's details stay editable so the agent can correct and resubmit it.
  const verifier = canVerifyLeads(actor);
  const workable = verifier || lead.verification === "approved";
  const [verifiedBy] = lead.verifiedById ? await db.select({ name: users.name }).from(users).where(eq(users.id, lead.verifiedById)) : [];
  return {
    generatedAt: Date.now(),
    lead: {
      ...row,
      phone: formatPhone(row.phoneCountryCode, row.phoneNumber),
      phoneE164: lead.phoneE164,
      /** Numbers 2–5. */
      phones: (await leadPhonesOf(db, lead.id)).map((p) => ({ ...p, display: formatPhone(p.countryCode, p.number) })),
      clientId: lead.clientId,
      projectId: lead.projectId,
      cityId: lead.cityId,
      cityOther: lead.cityOther,
      sourceId: lead.sourceId,
      budgetRangeId: lead.budgetRangeId,
      gender: lead.gender,
      lostReason: lostReason[0]?.name ?? null,
      timeToFirstTouchMs: lead.firstTouchAt ? lead.firstTouchAt.getTime() - lead.createdAt.getTime() : null,
    },
    activities,
    followUps: followUpRows,
    pendingLostRequest: pendingRequest[0] ?? null,
    reviews,
    verification: {
      status: lead.verification,
      note: lead.verificationNote,
      verifiedAt: lead.verifiedAt,
      verifiedByName: verifiedBy?.name ?? null,
    },
    permissions: {
      edit: canDo(actor, "edit") && lead.stage !== "booked" && workable,
      /** The lead's details form: also open on a rejected lead so the agent can correct it. */
      editDetails: canDo(actor, "edit") && lead.stage !== "booked" && (workable || lead.verification === "rejected"),
      assign: canDo(actor, "assign"),
      markLostDirect: canDo(actor, "markLostDirect") && !closed && !openBooking && workable,
      requestLost: canDo(actor, "requestLost") && !closed && !openBooking && !pendingRequest[0] && workable,
      /** Lost is possible for this user, but only after the open booking is cancelled. */
      lostNeedsBookingCancelled: (canDo(actor, "markLostDirect") || canDo(actor, "requestLost")) && openBooking && workable,
      decideLost: canDo(actor, "decideLost") && Boolean(pendingRequest[0]),
      review: canDo(actor, "review") && workable,
      scheduleFollowUp: canDo(actor, "edit") && !closed && workable,
      verify: verifier && lead.verification === "pending",
      resubmit: lead.verification === "rejected" && (actor.role !== "agent" || lead.ownerId === actor.id),
    },
  };
}
export type LeadDetail = Awaited<ReturnType<typeof getLeadDetail>>;

/** Day boundaries in the business time zone, as UTC instants. */
function dayStart(now: Date, offsetDays: number) {
  const local = new Date(now.toLocaleString("en-US", { timeZone: BUSINESS_TIME_ZONE }));
  const diff = now.getTime() - local.getTime();
  local.setHours(0, 0, 0, 0);
  return new Date(local.getTime() + diff + offsetDays * 86_400_000);
}

export const TODO_BUCKETS = ["today", "doneToday", "tomorrow", "7d", "15d", "30d", "overdue", "unattended"] as const;
export type TodoBucket = (typeof TODO_BUCKETS)[number];

/**
 * To-dos & overdues (FR-027): lead follow-up buckets, 50 per page, so every item a count promises can
 * be reached. Task and meeting buckets come from their own modules on the To-dos page.
 */
export async function leadTodos(db: Database, actor: Actor, projectId: string, bucket: TodoBucket, now = new Date(), requestedPage: unknown = 1) {
  if (!canDo(actor, "view")) throw forbidden();
  const members = await teamMemberIds(db, actor);
  const scope = and(...baseConditions(actor, members, projectId));
  const today = dayStart(now, 0);
  const tomorrow = dayStart(now, 1);
  const dayAfter = dayStart(now, 2);

  // Pending work only on leads that aren't Lost (F-2); counts and lists both use `ranges`.
  const pending = and(eq(followUps.status, "pending"), followUpLeadActive())!;
  const ranges: Record<Exclude<TodoBucket, "unattended" | "doneToday">, SQL> = {
    today: and(pending, gte(followUps.dueAt, today), lt(followUps.dueAt, tomorrow))!,
    tomorrow: and(pending, gte(followUps.dueAt, tomorrow), lt(followUps.dueAt, dayAfter))!,
    "7d": and(pending, gte(followUps.dueAt, now), lt(followUps.dueAt, dayStart(now, 8)))!,
    "15d": and(pending, gte(followUps.dueAt, now), lt(followUps.dueAt, dayStart(now, 16)))!,
    "30d": and(pending, gte(followUps.dueAt, now), lt(followUps.dueAt, dayStart(now, 31)))!,
    overdue: and(pending, lt(followUps.dueAt, now))!,
  };
  const doneToday = and(eq(followUps.status, "done"), gte(followUps.doneAt, today))!;
  const unattended = and(
    scope,
    isNull(leads.firstTouchAt),
    eq(leads.stage, "new_lead"),
    lt(leads.createdAt, new Date(now.getTime() - UNATTENDED_HOURS * 3_600_000)),
  );

  const followUpCount = (cond: SQL) =>
    db
      .select({ n: count() })
      .from(followUps)
      .innerJoin(leads, eq(leads.id, followUps.leadId))
      .where(and(scope, cond))
      .then((r) => r[0].n);

  const [today_, done_, tomorrow_, d7, d15, d30, overdue_, unattended_] = await Promise.all([
    followUpCount(ranges.today),
    followUpCount(doneToday),
    followUpCount(ranges.tomorrow),
    followUpCount(ranges["7d"]),
    followUpCount(ranges["15d"]),
    followUpCount(ranges["30d"]),
    followUpCount(ranges.overdue),
    db.select({ n: count() }).from(leads).where(unattended).then((r) => r[0].n),
  ]);
  const counts: Record<TodoBucket, number> = {
    today: today_,
    doneToday: done_,
    tomorrow: tomorrow_,
    "7d": d7,
    "15d": d15,
    "30d": d30,
    overdue: overdue_,
    unattended: unattended_,
  };
  const { page, pageCount } = pageWithin(requestedPage, counts[bucket], PAGE_SIZE);
  const offset = (page - 1) * PAGE_SIZE;

  const leadColumns = {
    leadId: leads.id,
    code: leads.code,
    name: leads.name,
    stage: leads.stage,
    phoneCountryCode: leads.phoneCountryCode,
    phoneNumber: leads.phoneNumber,
    ownerName: owner.name,
    createdAt: leads.createdAt,
  };
  let items: {
    key: string;
    leadId: string;
    code: string;
    name: string;
    stage: LeadStage;
    phone: string;
    ownerName: string | null;
    dueAt: Date | null;
    note: string | null;
    followUpId: string | null;
    status: string | null;
  }[];

  if (bucket === "unattended") {
    const rows = await db
      .select(leadColumns)
      .from(leads)
      .leftJoin(owner, eq(owner.id, leads.ownerId))
      .where(unattended)
      .orderBy(asc(leads.createdAt), asc(leads.id))
      .limit(PAGE_SIZE)
      .offset(offset);
    items = rows.map((r) => ({
      key: r.leadId,
      ...r,
      phone: formatPhone(r.phoneCountryCode, r.phoneNumber),
      dueAt: null,
      note: null,
      followUpId: null,
      status: null,
    }));
  } else {
    const cond = bucket === "doneToday" ? doneToday : ranges[bucket];
    const rows = await db
      .select({ ...leadColumns, followUpId: followUps.id, dueAt: followUps.dueAt, note: followUps.note, status: followUps.status })
      .from(followUps)
      .innerJoin(leads, eq(leads.id, followUps.leadId))
      .leftJoin(owner, eq(owner.id, leads.ownerId))
      .where(and(scope, cond))
      .orderBy(asc(followUps.dueAt), asc(followUps.id))
      .limit(PAGE_SIZE)
      .offset(offset);
    items = rows.map((r) => ({ key: r.followUpId, ...r, phone: formatPhone(r.phoneCountryCode, r.phoneNumber) }));
  }
  return { counts, items, page, pageCount };
}

/** Lists paged at 50 (FR-005): page number from the query string, clamped to 1…10,000. */
export const SIDE_LIST_PAGE_SIZE = 50;
const pageOf = (raw: unknown) => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
};

/**
 * Non-duplicate leads in scope that share a phone number (FR-032, view only), 50 phone groups per
 * page (FR-005), oldest-shared number first. `totalLeads` counts every lead in every group.
 */
export async function sharedPhoneGroups(db: Database, actor: Actor, projectId: string, rawPage?: unknown) {
  if (!canDo(actor, "view")) throw forbidden();
  const members = await teamMemberIds(db, actor);
  const where = and(...baseConditions(actor, members, projectId), isNull(leads.duplicateOfId));
  const sharedAll = db
    .select({ phone: leads.phoneE164, n: sql<number>`count(*)::int`.as("n") })
    .from(leads)
    .where(where)
    .groupBy(leads.phoneE164)
    .having(sql`count(*) > 1`)
    .as("shared_all");
  const [totals] = await db.select({ groups: sql<number>`count(*)::int`, leads: sql<number>`coalesce(sum(${sharedAll.n}), 0)::int` }).from(sharedAll);
  const pageCount = Math.max(1, Math.ceil(totals.groups / SIDE_LIST_PAGE_SIZE));
  const page = Math.min(pageOf(rawPage), pageCount);
  const shared = db
    .select({ phone: leads.phoneE164 })
    .from(leads)
    .where(where)
    .groupBy(leads.phoneE164)
    .having(sql`count(*) > 1`)
    .orderBy(asc(leads.phoneE164))
    .limit(SIDE_LIST_PAGE_SIZE)
    .offset((page - 1) * SIDE_LIST_PAGE_SIZE);
  const rows = await db
    .select({
      id: leads.id,
      code: leads.code,
      name: leads.name,
      stage: leads.stage,
      phoneE164: leads.phoneE164,
      phoneCountryCode: leads.phoneCountryCode,
      phoneNumber: leads.phoneNumber,
      ownerName: owner.name,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .leftJoin(owner, eq(owner.id, leads.ownerId))
    .where(and(where, inArray(leads.phoneE164, shared)))
    .orderBy(asc(leads.phoneE164), asc(leads.createdAt));

  const byPhone = new Map<string, typeof rows>();
  for (const row of rows) byPhone.set(row.phoneE164, [...(byPhone.get(row.phoneE164) ?? []), row]);
  const groups = [...byPhone.entries()].map(([phone, items]) => ({
    phone: formatPhone(items[0].phoneCountryCode, items[0].phoneNumber),
    phoneE164: phone,
    leads: items,
  }));
  return { groups, page, pageCount, totalGroups: totals.groups, totalLeads: totals.leads };
}

/** Manager reviews on leads in the actor's scope (agents: their own leads), newest first, 50 per page. */
export async function reviewsFeed(db: Database, actor: Actor, projectId: string, rawPage?: unknown) {
  if (!canDo(actor, "view")) throw forbidden();
  const members = await teamMemberIds(db, actor);
  const scope = and(...baseConditions(actor, members, projectId));
  const [{ total }] = await db.select({ total: count() }).from(leadReviews).innerJoin(leads, eq(leads.id, leadReviews.leadId)).where(scope);
  const pageCount = Math.max(1, Math.ceil(total / SIDE_LIST_PAGE_SIZE));
  const page = Math.min(pageOf(rawPage), pageCount);
  const rows = await db
    .select({
      id: leadReviews.id,
      body: leadReviews.body,
      createdAt: leadReviews.createdAt,
      reviewerName: users.name,
      leadId: leads.id,
      leadName: leads.name,
      leadCode: leads.code,
      stage: leads.stage,
    })
    .from(leadReviews)
    .innerJoin(leads, eq(leads.id, leadReviews.leadId))
    .innerJoin(users, eq(users.id, leadReviews.reviewerId))
    .where(scope)
    .orderBy(desc(leadReviews.createdAt), desc(leadReviews.id))
    .limit(SIDE_LIST_PAGE_SIZE)
    .offset((page - 1) * SIDE_LIST_PAGE_SIZE);
  return { rows, page, pageCount, total };
}

/** Pending lost requests the actor can decide (managers: their teams; admins: all). */
export async function pendingLostRequests(db: Database, actor: Actor, projectId: string) {
  if (!canDo(actor, "view")) throw forbidden();
  if (!canDo(actor, "decideLost")) return [];
  const members = await teamMemberIds(db, actor);
  const requester = alias(users, "requester");
  return db
    .select({
      id: approvals.id,
      createdAt: approvals.createdAt,
      note: approvals.note,
      reason: lostReasons.name,
      requesterName: requester.name,
      leadId: leads.id,
      leadName: leads.name,
      leadCode: leads.code,
      stage: leads.stage,
    })
    .from(approvals)
    .innerJoin(leads, eq(leads.id, approvals.leadId))
    .innerJoin(requester, eq(requester.id, approvals.requestedById))
    .leftJoin(lostReasons, eq(lostReasons.id, approvals.lostReasonId))
    .where(and(eq(approvals.status, "pending"), ...baseConditions(actor, members, projectId)))
    .orderBy(asc(approvals.createdAt));
}

export async function lostReasonMix(db: Database, actor: Actor, projectId: string) {
  if (!canDo(actor, "view")) throw forbidden();
  const members = await teamMemberIds(db, actor);
  return db
    .select({ reason: lostReasons.name, total: count() })
    .from(leads)
    .leftJoin(lostReasons, eq(lostReasons.id, leads.lostReasonId))
    .where(and(...baseConditions(actor, members, projectId), eq(leads.stage, "lost_lead")))
    .groupBy(lostReasons.name)
    .orderBy(desc(count()));
}

export async function leadLookups(db: Database) {
  const pick = { id: leadSources.id, name: leadSources.name };
  const [sources, allCities, budgets, reasons, sizes] = await Promise.all([
    db.select(pick).from(leadSources).where(eq(leadSources.isActive, true)).orderBy(asc(leadSources.sortOrder)),
    db.select({ id: cities.id, name: cities.name, isActive: cities.isActive }).from(cities).orderBy(asc(cities.sortOrder), asc(cities.name)),
    db
      .select({ id: budgetRanges.id, name: budgetRanges.name })
      .from(budgetRanges)
      .where(eq(budgetRanges.isActive, true))
      .orderBy(asc(budgetRanges.sortOrder)),
    db
      .select({ id: lostReasons.id, name: lostReasons.name })
      .from(lostReasons)
      .where(eq(lostReasons.isActive, true))
      .orderBy(asc(lostReasons.sortOrder)),
    // The Size dropdown offers each project's unit sizes from inventory.
    db.selectDistinct({ projectId: units.projectId, areaSqft: units.areaSqft }).from(units).orderBy(asc(units.projectId), asc(units.areaSqft)),
  ]);
  const active = allCities.filter((c) => c.isActive).map(({ id, name }) => ({ id, name }));
  return {
    sources,
    cities: active,
    /** Deactivated cities stay filterable, because existing leads keep them. */
    filterCities: [
      ...active,
      ...allCities.filter((c) => !c.isActive).map(({ id, name }) => ({ id, name: `${name} (inactive)` })),
      { id: OTHER_CITY, name: "Other" },
    ],
    budgets,
    lostReasons: reasons,
    unitSizes: sizes,
  };
}
export type LeadLookups = Awaited<ReturnType<typeof leadLookups>>;

/** Users the actor may assign leads to. */
export async function assignableUsers(db: Database, actor: Actor) {
  if (!canDo(actor, "assign")) return [];
  const scope = leadScope(actor.role);
  const base = and(eq(users.status, "active"), inArray(users.role, ["agent", "manager"]));
  if (scope === "all") {
    return db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(base).orderBy(asc(users.name));
  }
  const members = await teamMemberIds(db, actor);
  return db
    .selectDistinct({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .leftJoin(teamMembers, eq(teamMembers.userId, users.id))
    .where(and(base, inArray(users.id, [actor.id, ...members])))
    .orderBy(asc(users.name));
}

export async function activeProjects(db: Database) {
  return db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.status, "active"))
    .orderBy(asc(projects.name));
}

/** Re-checks a lead id the client sent (e.g. after a duplicate warning) is visible to the actor. */
export async function isLeadVisible(db: Database, actor: Actor, leadId: string) {
  const [lead] = await db.select({ ownerId: leads.ownerId }).from(leads).where(eq(leads.id, leadId));
  if (!lead) return false;
  return canAccessLead(actor, lead.ownerId, await teamMemberIds(db, actor));
}
