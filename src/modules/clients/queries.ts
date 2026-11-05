import { clientInvestedIn, latestInvestments } from "@/modules/bookings/queries";
import { canDoBooking } from "@/modules/bookings/policy";
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { Database } from "@/server/db";
import { cities, clientActivities, clientFollowUps, clients, leads, projects, users } from "@/server/db/schema";
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
  const latest = await latestInvestments(db, actor, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, latestInvestment: latest.get(r.id) ?? null }));
}

export async function getClientDetail(db: Database, actor: Actor, clientId: string) {
  if (!canDoClient(actor, "view")) throw forbidden();
  const { client, members } = await loadAccessibleClient(db, actor, clientId);
  const actorUser = alias(users, "activity_actor");
  const leadOwner = alias(users, "lead_owner");

  const [[row], linked, activities, followUpRows] = await Promise.all([
    db
      .select(listSelection)
      .from(clients)
      .leftJoin(owner, eq(owner.id, clients.ownerId))
      .leftJoin(cities, eq(cities.id, clients.cityId))
      .where(eq(clients.id, clientId)),
    db
      .select({
        id: leads.id,
        code: leads.code,
        name: leads.name,
        stage: leads.stage,
        ownerId: leads.ownerId,
        ownerName: leadOwner.name,
        projectName: projects.name,
        createdAt: leads.createdAt,
      })
      .from(leads)
      .leftJoin(leadOwner, eq(leadOwner.id, leads.ownerId))
      .leftJoin(projects, eq(projects.id, leads.projectId))
      .where(and(eq(leads.clientId, clientId), isNull(leads.deletedAt)))
      .orderBy(desc(leads.createdAt)),
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

  // Linked leads follow Leads permissions: only those the actor could open in Leads are listed.
  const visibleLeads = linked.filter((l) => canAccessLead(actor, l.ownerId, members));
  const canEdit = canDoClient(actor, "edit");
  return {
    generatedAt: Date.now(),
    client: {
      ...row,
      phone: formatPhone(row.phoneCountryCode, row.phoneNumber),
      phoneE164: client.phoneE164,
      cityId: client.cityId,
      cityOther: client.cityOther,
      lastActivityAt: client.lastActivityAt,
    },
    linkedLeads: visibleLeads,
    hiddenLeadCount: linked.length - visibleLeads.length,
    activities,
    followUps: followUpRows,
    permissions: { edit: canEdit, assign: canDoClient(actor, "assign"), scheduleFollowUp: canEdit },
  };
}
export type ClientDetail = Awaited<ReturnType<typeof getClientDetail>>;

export type LeadClientStatus =
  | { status: "linked"; client: { id: string; name: string } | null }
  | { status: "match"; client: { id: string; name: string } }
  | { status: "hiddenMatch" }
  | { status: "convertible" }
  | null;

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
  if (!canDoClient(actor, "convertLead")) return null;
  const [match] = await db
    .select({ id: clients.id, name: clients.name, ownerId: clients.ownerId })
    .from(clients)
    .where(eq(clients.phoneE164, lead.phoneE164));
  if (!match) return { status: "convertible" };
  return canAccessClient(actor, match.ownerId, members)
    ? { status: "match", client: { id: match.id, name: match.name } }
    : { status: "hiddenMatch" };
}
