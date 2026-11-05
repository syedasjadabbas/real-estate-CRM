import { and, asc, count, countDistinct, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/server/db";
import { clients, leads, projects, units } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { forbidden, notFound } from "@/server/errors";
import { canDoClient } from "@/modules/clients/policy";
import { unitCounts } from "@/modules/inventory/queries";
import { clientScopeFilter } from "@/modules/clients/support";
import { canDo } from "@/modules/leads/policy";
import { scopeFilter, teamMemberIds } from "@/modules/leads/support";
import { PROJECT_PAGE_SIZE, type ProjectSort } from "./constants";
import { canDoProject, seesInactiveInSelector } from "./policy";
import { projectListQuerySchema } from "./validation";

function searchCondition(q: string | undefined): SQL | undefined {
  if (!q) return undefined;
  const term = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return or(ilike(projects.name, term), ilike(projects.developer, term), ilike(projects.city, term));
}

const cardSelection = {
  id: projects.id,
  name: projects.name,
  type: projects.type,
  status: projects.status,
  developer: projects.developer,
  city: projects.city,
  updatedAt: projects.updatedAt,
};

/** The only expressions a sort can reach: `sort` is validated against this list's keys. */
const SORTS: Record<ProjectSort, SQL> = {
  name: sql`lower(${projects.name})`,
  type: sql`${projects.type}::text`,
  status: sql`${projects.status}::text`,
  developer: sql`lower(${projects.developer})`,
  city: sql`lower(${projects.city})`,
  units: sql`(select count(*) from ${units} where ${units.projectId} = ${projects.id})`,
};

export type ProjectCard = Awaited<ReturnType<typeof listProjects>>["rows"][number];

/**
 * Project cards with KPI tiles (reference: Projects · Units tracked · Project types).
 * Every role that may view projects sees inactive ones here (the reference showed INACTIVE cards to an agent).
 */
export async function listProjects(db: Database, actor: Actor, rawQuery: unknown) {
  if (!canDoProject(actor, "view")) throw forbidden();
  const query = projectListQuerySchema.parse(rawQuery ?? {});
  const where = and(
    searchCondition(query.q),
    query.type ? eq(projects.type, query.type) : undefined,
    query.status ? eq(projects.status, query.status) : undefined,
  );

  const [[kpi], [{ total }], [{ units: unitsTracked }], perProject] = await Promise.all([
    db.select({ projects: count(), types: countDistinct(projects.type) }).from(projects),
    db.select({ total: count() }).from(projects).where(where),
    db.select({ units: count() }).from(units),
    unitCounts(db),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PROJECT_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  // Name, then id, settle ties, so equal values keep their order from page to page.
  const byName = [asc(sql`lower(${projects.name})`), asc(projects.id)];
  const order = query.sort
    ? [query.dir === "asc" ? sql`${SORTS[query.sort]} asc nulls last` : sql`${SORTS[query.sort]} desc nulls last`, ...byName]
    : [asc(projects.status), ...byName];
  const rows = await db
    .select(cardSelection)
    .from(projects)
    .where(where)
    .orderBy(...order)
    .limit(PROJECT_PAGE_SIZE)
    .offset((page - 1) * PROJECT_PAGE_SIZE);

  return {
    query: { ...query, page },
    kpis: { projects: kpi.projects, projectTypes: kpi.types, unitsTracked },
    total,
    page,
    pageCount,
    rows: rows.map((r) => ({ ...r, unitsTracked: perProject.get(r.id) ?? 0 })),
  };
}

/**
 * Project detail plus its links: leads in the viewer's lead scope and clients (via those leads)
 * in the viewer's client scope. Roles without Leads / Clients access get null, not zero.
 */
export async function getProjectDetail(db: Database, actor: Actor, projectId: string) {
  if (!canDoProject(actor, "view")) throw forbidden();
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw notFound("Project");
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw notFound("Project");

  const members = await teamMemberIds(db, actor);
  const inProject = and(eq(leads.projectId, projectId), isNull(leads.deletedAt));
  const [leadRow, clientRow, [{ units: unitsTracked }]] = await Promise.all([
    canDo(actor, "view")
      ? db.select({ n: count() }).from(leads).where(and(inProject, scopeFilter(actor, members)))
      : Promise.resolve(null),
    canDoClient(actor, "view")
      ? db
          .select({ n: countDistinct(clients.id) })
          .from(clients)
          .innerJoin(leads, eq(leads.clientId, clients.id))
          .where(and(inProject, clientScopeFilter(actor, members)))
      : Promise.resolve(null),
    db.select({ units: count() }).from(units).where(eq(units.projectId, projectId)),
  ]);

  return {
    project,
    links: {
      leads: leadRow ? leadRow[0].n : null,
      clients: clientRow ? clientRow[0].n : null,
      unitsTracked,
    },
    permissions: { manage: canDoProject(actor, "manage") },
  };
}
export type ProjectDetail = Awaited<ReturnType<typeof getProjectDetail>>;

/**
 * Projects offered in the header selector. Admins also see inactive ones (labelled);
 * everyone else sees active projects only (FR-060 acceptance criterion).
 */
/** The browser cookie holding one person's chosen project: FR-004 remembers it per user and device. */
export const projectCookieName = (userId: string) => `mz_project_${userId}`;

/**
 * The projects offered to this person and the active one. Only their own saved choice is read, so
 * nobody inherits another person's project on a shared browser. A choice they can no longer select
 * (inactive, removed) falls back to the first project they can.
 */
export async function activeProjectFor(db: Database, actor: Pick<Actor, "id" | "role"> | null, readCookie: (name: string) => string | undefined) {
  const projects = await selectableProjects(db, actor);
  const chosen = actor ? readCookie(projectCookieName(actor.id)) : undefined;
  const active = projects.find((p) => p.id === chosen) ?? projects[0] ?? null;
  return { projects, activeProjectId: active?.id ?? null };
}

export async function selectableProjects(db: Database, actor: Pick<Actor, "role"> | null) {
  const includeInactive = actor ? seesInactiveInSelector(actor) : false;
  const rows = await db
    .select({ id: projects.id, name: projects.name, status: projects.status })
    .from(projects)
    .where(includeInactive ? undefined : eq(projects.status, "active"))
    .orderBy(asc(projects.status), asc(projects.name));
  return rows.map((p) => ({ id: p.id, name: p.status === "active" ? p.name : `${p.name} (inactive)` }));
}

