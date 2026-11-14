import { clientPhonesOf } from "@/modules/contacts/phones";
import { clientInvestedIn, latestInvestments } from "@/modules/bookings/queries";
import { canDoBooking } from "@/modules/bookings/policy";
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { Database } from "@/server/db";
import { cities, clientActivities, clientFollowUps, clientPhones, clients, leadPhones, leads, projects, users } from "@/server/db/schema";
import type { LeadStage } from "@/modules/leads/constants";
import type { Actor } from "@/server/auth/types";
import { forbidden } from "@/server/errors";
import { formatPhone } from "@/modules/leads/phone";
import { canAccessLead } from "@/modules/leads/policy";
import { CLIENT_PAGE_SIZE, type ClientSortColumn } from "./constants";
import { canAccessClient, canDoClient } from "./policy";
import { clientScopeFilter, loadAccessibleClient, teamMemberIds } from "./support";
import { clientListQuerySchema } from "./validation";

const owner = alias(users, "owner");

function searchCondition(q: string | undefined): SQL | undefined {
  if (!q) return undefined;
  const term = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const digits = q.replace(/\D/g, "").replace(/^0+/, "");
  const parts: SQL[] = [ilike(clients.name, term), ilike(clients.email, term)];
  if (digits.length >= 3) parts.push(ilike(clients.phoneE164, `%${digits}%`));
  if (/^[0-9a-f-]{36}$/i.test(q)) parts.push(eq(clients.id, q));
  return or(...parts);
}

const sortColumns: Record<ClientSortColumn, SQL | AnyPgColumn> = {
  updatedAt: clients.updatedAt,
  name: sql`lower(${clients.name})`,
  nextFollowUpAt: clients.nextFollowUpAt,
  relationship: clients.relationship,
};

const listSelection = {
  id: clients.id,
  name: clients.name,
  phoneCountryCode: clients.phoneCountryCode,
  phoneNumber: clients.phoneNumber,
  email: clients.email,
  relationship: clients.relationship,
  cityName: sql<string | null>`coalesce(${cities.name}, ${clients.cityOther})`.as("city_name"),
  ownerId: clients.ownerId,
  ownerName: owner.name,
  nextFollowUpAt: clients.nextFollowUpAt,
  createdAt: clients.createdAt,
  updatedAt: clients.updatedAt,
};

export type ClientListRow = Awaited<ReturnType<typeof listClients>>["rows"][number];

/**
 * Clients are long-term profiles across projects, so the list is not filtered by the
 * header's project selector. "Latest investment" and the project filter use bookings the actor may see.
 */
export async function listClients(db: Database, actor: Actor, rawQuery: unknown, now = new Date()) {
  if (!canDoClient(actor, "view")) throw forbidden();
  const query = clientListQuerySchema.parse(rawQuery ?? {});
  const members = await teamMemberIds(db, actor);
  const investedFilter = query.project && canDoBooking(actor, "view") ? clientInvestedIn(actor, members, query.project) : undefined;
  const where = and(clientScopeFilter(actor, members), searchCondition(query.q), investedFilter);
  const column = sortColumns[query.sort];

  const [{ total }] = await db.select({ total: count() }).from(clients).where(where);
  const pageCount = Math.max(1, Math.ceil(total / CLIENT_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  const rows = await db
    .select(listSelection)
    .from(clients)
    .leftJoin(owner, eq(owner.id, clients.ownerId))
    .leftJoin(cities, eq(cities.id, clients.cityId))
    .where(where)
    .orderBy(query.dir === "asc" ? sql`${column} asc nulls last` : sql`${column} desc nulls last`, desc(clients.createdAt))
    .limit(CLIENT_PAGE_SIZE)
    .offset((page - 1) * CLIENT_PAGE_SIZE);

  return {
    generatedAt: now.getTime(),
    query: { ...query, page },
    total,
    page,
    pageCount,
    pageSize: CLIENT_PAGE_SIZE,
    rows: await withInvestments(db, actor, rows.map((r) => ({ ...r, phone: formatPhone(r.phoneCountryCode, r.phoneNumber) }))),
  };
}

async function withInvestments<T extends { id: string }>(db: Database, actor: Actor, rows: T[]) {
  const ids = rows.map((r) => r.id);
  const [latest, interests] = await Promise.all([latestInvestments(db, actor, ids), clientInterestProjects(db, ids)]);
  return rows.map((r) => ({ ...r, latestInvestment: latest.get(r.id) ?? null, interests: interests.get(r.id) ?? [] }));
}

/**
 * A client is one person across the system; each inquiry they make is a lead in some project.
 * Their leads are those linked to them plus any lead holding one of their numbers (primary or
 * extra, on either side), so a new inquiry shows up before anyone links it.
 */
async function customerLeads(db: Database, clientIds: string[]) {
  const result = new Map<string, CustomerLead[]>();
  if (clientIds.length === 0) return result;
  const [primary, extra] = await Promise.all([
    db.select({ clientId: clients.id, e164: clients.phoneE164 }).from(clients).where(inArray(clients.id, clientIds)),
    db.select({ clientId: clientPhones.clientId, e164: clientPhones.e164 }).from(clientPhones).where(inArray(clientPhones.clientId, clientIds)),
  ]);
  const numbersOf = new Map<string, Set<string>>();
  for (const { clientId, e164 } of [...primary, ...extra]) {
    if (!numbersOf.has(clientId)) numbersOf.set(clientId, new Set());
    numbersOf.get(clientId)!.add(e164);
  }
  const allNumbers = [...new Set([...primary, ...extra].map((n) => n.e164))];
  const leadOwner = alias(users, "interest_owner");
  const rows = await db
    .select({
      id: leads.id,
      code: leads.code,
      name: leads.name,
      stage: leads.stage,
      ownerId: leads.ownerId,
      ownerName: leadOwner.name,
      projectId: leads.projectId,
      projectName: projects.name,
      clientId: leads.clientId,
      phoneE164: leads.phoneE164,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .leftJoin(leadOwner, eq(leadOwner.id, leads.ownerId))
    .leftJoin(projects, eq(projects.id, leads.projectId))
    .where(
      and(
        isNull(leads.deletedAt),
        or(
          inArray(leads.clientId, clientIds),
          allNumbers.length ? inArray(leads.phoneE164, allNumbers) : undefined,
          allNumbers.length ? sql`exists (select 1 from ${leadPhones} lp where lp.lead_id = ${leads.id} and lp.e164 in ${allNumbers})` : undefined,
        ),
      ),
    )
    .orderBy(desc(leads.createdAt));
  const extraOfLead = new Map<string, string[]>();
  if (rows.length) {
    for (const p of await db.select({ leadId: leadPhones.leadId, e164: leadPhones.e164 }).from(leadPhones).where(inArray(leadPhones.leadId, rows.map((r) => r.id)))) {
      extraOfLead.set(p.leadId, [...(extraOfLead.get(p.leadId) ?? []), p.e164]);
    }
  }
  for (const clientId of clientIds) {
    const numbers = numbersOf.get(clientId) ?? new Set<string>();
    result.set(
      clientId,
      rows.filter((r) => r.clientId === clientId || numbers.has(r.phoneE164) || (extraOfLead.get(r.id) ?? []).some((n) => numbers.has(n))),
    );
  }
  return result;
}
type CustomerLead = {
  id: string;
  code: string;
  name: string;
  stage: LeadStage;
  ownerId: string | null;
  ownerName: string | null;
  projectId: string;
  projectName: string | null;
  clientId: string | null;
  phoneE164: string;
  createdAt: Date;
};

/**
 * A client's standing in one project, from their leads there: booked if any lead is booked, lost
 * once every lead there is lost, otherwise still interested.
 */
export type InterestStatus = "interested" | "lost" | "booked";
function interestStatus(stages: LeadStage[]): InterestStatus {
  if (stages.includes("booked")) return "booked";
  return stages.length > 0 && stages.every((s) => s === "lost_lead") ? "lost" : "interested";
}

/** Projects a client has enquired in with their standing, current interests first (for the clients list). */
export async function clientInterestProjects(db: Database, clientIds: string[]) {
  const byClient = await customerLeads(db, clientIds);
  return new Map(
    [...byClient].map(([clientId, rows]) => {
      const byProject = new Map<string, { projectId: string; projectName: string; stages: LeadStage[] }>();
      for (const r of rows) {
        const p = byProject.get(r.projectId) ?? { projectId: r.projectId, projectName: r.projectName ?? "Project", stages: [] };
        p.stages.push(r.stage);
        byProject.set(r.projectId, p);
      }
      const list = [...byProject.values()].map((p) => ({ projectId: p.projectId, projectName: p.projectName, status: interestStatus(p.stages) }));
      return [clientId, list.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])];
    }),
  );
}
const STATUS_ORDER: Record<InterestStatus, number> = { booked: 0, interested: 1, lost: 2 };

/**
 * The client's interests grouped by project, most recent inquiry first. Leads the actor could not
 * open in Leads are only counted; the project still shows, since the interest is the client's.
 */
function groupInterests(rows: CustomerLead[], visible: (l: CustomerLead) => boolean) {
  const groups = new Map<string, { projectId: string; projectName: string; latestAt: Date; leads: CustomerLead[]; hiddenCount: number; stages: LeadStage[] }>();
  for (const r of rows) {
    let g = groups.get(r.projectId);
    if (!g) {
      g = { projectId: r.projectId, projectName: r.projectName ?? "Project", latestAt: r.createdAt, leads: [], hiddenCount: 0, stages: [] };
      groups.set(r.projectId, g);
    }
    if (r.createdAt > g.latestAt) g.latestAt = r.createdAt;
    g.stages.push(r.stage);
    if (visible(r)) g.leads.push(r);
    else g.hiddenCount += 1;
  }
  // Current interests first (booked, then interested), lost ones last; newest first within each.
  return [...groups.values()]
    .map(({ stages, ...g }) => ({ ...g, status: interestStatus(stages) }))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.latestAt.getTime() - a.latestAt.getTime());
}

export async function getClientDetail(db: Database, actor: Actor, clientId: string) {
  if (!canDoClient(actor, "view")) throw forbidden();
  const { client, members } = await loadAccessibleClient(db, actor, clientId);
  const actorUser = alias(users, "activity_actor");

  const [[row], linkedByClient, activities, followUpRows] = await Promise.all([
    db
      .select(listSelection)
      .from(clients)
      .leftJoin(owner, eq(owner.id, clients.ownerId))
      .leftJoin(cities, eq(cities.id, clients.cityId))
      .where(eq(clients.id, clientId)),
    customerLeads(db, [clientId]),
    db
      .select({
        id: clientActivities.id,
        type: clientActivities.type,
        body: clientActivities.body,
        data: clientActivities.data,
        createdAt: clientActivities.createdAt,
        actorName: actorUser.name,
      })
      .from(clientActivities)
      .leftJoin(actorUser, eq(actorUser.id, clientActivities.actorId))
      .where(eq(clientActivities.clientId, clientId))
      .orderBy(desc(clientActivities.createdAt)),
    db
      .select({
        id: clientFollowUps.id,
        dueAt: clientFollowUps.dueAt,
        note: clientFollowUps.note,
        status: clientFollowUps.status,
        doneAt: clientFollowUps.doneAt,
      })
      .from(clientFollowUps)
      .where(eq(clientFollowUps.clientId, clientId))
      .orderBy(asc(clientFollowUps.status), asc(clientFollowUps.dueAt)),
  ]);

  // Leads follow Leads permissions: only those the actor could open in Leads are listed.
  const linked = linkedByClient.get(clientId) ?? [];
  const canOpen = (l: CustomerLead) => canAccessLead(actor, l.ownerId, members);
  const visibleLeads = linked.filter(canOpen);
  const canEdit = canDoClient(actor, "edit");
  return {
    generatedAt: Date.now(),
    client: {
      ...row,
      phone: formatPhone(row.phoneCountryCode, row.phoneNumber),
      phoneE164: client.phoneE164,
      cityId: client.cityId,
      cityOther: client.cityOther,
      /** Numbers 2–5. */
      phones: (await clientPhonesOf(db, client.id)).map((p) => ({ ...p, display: formatPhone(p.countryCode, p.number) })),
      lastActivityAt: client.lastActivityAt,
    },
    linkedLeads: visibleLeads,
    hiddenLeadCount: linked.length - visibleLeads.length,
    /** Projects the client has enquired in, each with its leads (by link or phone). */
    interests: groupInterests(linked, canOpen),
    activities,
    followUps: followUpRows,
    permissions: { edit: canEdit, assign: canDoClient(actor, "assign"), scheduleFollowUp: canEdit, /** Agents never change phone numbers (14 Nov 2026). */ editPhones: actor.role !== "agent" },
  };
}
export type ClientDetail = Awaited<ReturnType<typeof getClientDetail>>;

/** The client a lead belongs to; `client` is null when the actor can't open that profile. */
export type LeadClientStatus = { status: "linked"; client: { id: string; name: string } | null } | null;

/** Client panel on a lead page: linked client, a client with the same phone, or a convert option. */
export async function clientStatusForLead(
  db: Database,
  actor: Actor,
  lead: { id: string; clientId: string | null; phoneE164: string },
): Promise<LeadClientStatus> {
  const members = await teamMemberIds(db, actor);
  if (lead.clientId) {
    if (!canDoClient(actor, "view")) return null;
    const [linked] = await db
      .select({ id: clients.id, name: clients.name, ownerId: clients.ownerId })
      .from(clients)
      .where(eq(clients.id, lead.clientId));
    const visible = linked && canAccessClient(actor, linked.ownerId, members);
    return { status: "linked", client: visible ? { id: linked.id, name: linked.name } : null };
  }
  // Every lead has a client since 13 Nov 2026 (created with the lead); nothing is left to convert.
  return null;
}
