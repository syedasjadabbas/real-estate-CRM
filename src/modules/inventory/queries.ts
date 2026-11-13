import { AREA_FILTER, DIMENSION_FIELD, DIMENSION_KEYS, DIMENSION_LABELS } from "./constants";
import { and, asc, count, desc, eq, ilike, isNotNull, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/server/db";
import { auditLogs, projects, units, users } from "@/server/db/schema";

/** When a booked unit was booked: its active booking's confirmation date (else when it was made). */
const bookedOnSql = sql`(select coalesce(b.confirmed_at, b.created_at) from bookings b where b.unit_id = ${units.id} and b.stage <> 'cancelled' order by b.created_at desc limit 1)`;
import type { Actor } from "@/server/auth/types";
import { forbidden, notFound } from "@/server/errors";
import { UNIT_PAGE_SIZE, type UnitSortColumn } from "./constants";
import { canDoInventory } from "./policy";
import { unitListQuerySchema } from "./validation";

function searchCondition(q: string | undefined): SQL | undefined {
  if (!q) return undefined;
  const term = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return or(
    ilike(units.unitNo, term),
    ilike(units.floor, term),
    ilike(units.block, term),
    ilike(units.category, term),
    ilike(units.type, term),
    ilike(units.comment, term),
  );
}

const rowSelection = {
  id: units.id,
  projectId: units.projectId,
  projectName: projects.name,
  unitNo: units.unitNo,
  floor: units.floor,
  block: units.block,
  saleModel: units.saleModel,
  areaSqft: units.areaSqft,
  basePrice: units.basePrice,
  nature: units.nature,
  category: units.category,
  type: units.type,
  bedrooms: units.bedrooms,
  premium: units.premium,
  status: units.status,
  statusChangedAt: units.statusChangedAt,
  comment: units.comment,
  listedOn: units.listedOn,
  /** Shown only for booked, partially booked and sold units (owner, 13 Nov 2026). */
  bookedOn: sql<string | null>`case when ${units.status} in ('booked', 'partially_booked', 'sold') then ${bookedOnSql} end`,
  createdAt: units.createdAt,
  updatedAt: units.updatedAt,
};

/** Text columns sort case-insensitively, with blanks treated as empty. */
const text = (column: SQLWrapper) => sql`nullif(lower(trim(${column})), '')`;

/** The only expressions a sort can reach: `sort` is validated against this list's keys. */
const SORTS: Record<UnitSortColumn, SQL> = {
  project: sql`lower(${projects.name})`,
  floor: text(units.floor),
  unit: text(units.unitNo),
  saleModel: sql`${units.saleModel}::text`,
  area: sql`${units.areaSqft}`,
  price: sql`${units.basePrice}`,
  nature: text(units.nature),
  category: text(units.category),
  status: sql`${units.status}::text`,
  type: text(units.type),
  bedrooms: sql`${units.bedrooms}`,
  listedOn: sql`${units.listedOn}`,
  bookedOn: sql`case when ${units.status} in ('booked', 'partially_booked', 'sold') then ${bookedOnSql} end`,
};

export type UnitRow = Awaited<ReturnType<typeof listUnits>>["rows"][number];

/**
 * FR-061: one filter per dimension of a single project. Options are the project's configured list,
 * then any other values its units hold, so units entered before configuration stay findable.
 * Size has no configured list, so it offers the areas in use. Dimensions with no values are left out.
 */
async function projectDimensionFilters(db: Database, projectId: string) {
  const [[project], areas, ...used] = await Promise.all([
    db.select({ dimensionConfig: projects.dimensionConfig }).from(projects).where(eq(projects.id, projectId)),
    db.selectDistinct({ area: units.areaSqft }).from(units).where(eq(units.projectId, projectId)).orderBy(asc(units.areaSqft)),
    ...DIMENSION_KEYS.map((key) => {
      const column = units[DIMENSION_FIELD[key]];
      return db.selectDistinct({ value: column }).from(units).where(and(eq(units.projectId, projectId), isNotNull(column))).orderBy(asc(column));
    }),
  ]);
  const filters = DIMENSION_KEYS.map((key, i) => {
    const seen = new Set<string>();
    const options = [...(project?.dimensionConfig[key] ?? []), ...used[i].map((r) => r.value as string)].filter((v) => {
      const folded = v.toLowerCase();
      return !seen.has(folded) && seen.add(folded);
    });
    return { param: DIMENSION_FIELD[key] as string, label: DIMENSION_LABELS[key], options: options.map((v) => ({ value: v, label: v })) };
  });
  const size = { param: AREA_FILTER as string, label: "Sizes", options: areas.map((r) => ({ value: String(r.area), label: `${r.area.toLocaleString("en-US")} sq ft` })) };
  return [...filters, size].filter((f) => f.options.length > 0);
}

/**
 * FR-073 list: search, project, status, nature, sale model, and FR-061 dimensions. `defaultProjectId` is the header
 * project, used when the URL names none (ASSUMED: the reference scopes lists by the header project
 * and also offers a Project filter); `project=all` lists every project.
 */
export async function listUnits(db: Database, actor: Actor, rawQuery: unknown, defaultProjectId: string | null) {
  if (!canDoInventory(actor, "view")) throw forbidden();
  const query = unitListQuerySchema.parse(rawQuery ?? {});
  const projectId = query.project === "all" ? null : (query.project ?? defaultProjectId);
  const where = and(
    projectId ? eq(units.projectId, projectId) : undefined,
    searchCondition(query.q),
    query.status ? eq(units.status, query.status) : undefined,
    query.saleModel ? eq(units.saleModel, query.saleModel) : undefined,
    query.nature ? sql`lower(${units.nature}) = lower(${query.nature})` : undefined,
    ...DIMENSION_KEYS.map((key) => {
      const field = DIMENSION_FIELD[key];
      const value = query[field];
      return value ? sql`lower(${units[field]}) = lower(${value})` : undefined;
    }),
    query.area ? eq(units.areaSqft, query.area) : undefined,
  );

  const [[{ total }], natures, byStatus, dimensionFilters] = await Promise.all([
    db.select({ total: count() }).from(units).where(where),
    db
      .selectDistinct({ nature: units.nature })
      .from(units)
      .where(and(isNotNull(units.nature), projectId ? eq(units.projectId, projectId) : undefined))
      .orderBy(asc(units.nature)),
    db
      .select({ status: units.status, n: count() })
      .from(units)
      .where(projectId ? eq(units.projectId, projectId) : undefined)
      .groupBy(units.status),
    projectId ? projectDimensionFilters(db, projectId) : [],
  ]);
  const pageCount = Math.max(1, Math.ceil(total / UNIT_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  // The default order, then the id, settle ties, so equal values keep their order from page to page.
  const byDefault = [asc(projects.name), asc(sql`lower(${units.floor})`), asc(sql`lower(${units.unitNo})`), asc(units.id)];
  const order = query.sort ? [query.dir === "asc" ? sql`${SORTS[query.sort]} asc nulls last` : sql`${SORTS[query.sort]} desc nulls last`, ...byDefault] : byDefault;
  const rows = await db
    .select(rowSelection)
    .from(units)
    .innerJoin(projects, eq(projects.id, units.projectId))
    .where(where)
    .orderBy(...order)
    .limit(UNIT_PAGE_SIZE)
    .offset((page - 1) * UNIT_PAGE_SIZE);

  return {
    query: { ...query, page },
    projectId,
    total,
    page,
    pageCount,
    pageSize: UNIT_PAGE_SIZE,
    natures: natures.map((n) => n.nature as string),
    dimensionFilters,
    statusCounts: Object.fromEntries(byStatus.map((s) => [s.status, s.n])) as Partial<Record<(typeof units.$inferSelect)["status"], number>>,
    rows,
  };
}

/** FR-074 unit detail. Booking history arrives with Bookings; status and edit history come from the audit log. */
export async function getUnitDetail(db: Database, actor: Actor, unitId: string) {
  if (!canDoInventory(actor, "view")) throw forbidden();
  if (!/^[0-9a-f-]{36}$/i.test(unitId)) throw notFound("Unit");
  const [row] = await db.select(rowSelection).from(units).innerJoin(projects, eq(projects.id, units.projectId)).where(eq(units.id, unitId));
  if (!row) throw notFound("Unit");
  const [project] = await db.select({ dimensionConfig: projects.dimensionConfig }).from(projects).where(eq(projects.id, row.projectId));
  const actorUser = alias(users, "history_actor");
  const history = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      before: auditLogs.before,
      after: auditLogs.after,
      createdAt: auditLogs.createdAt,
      actorName: actorUser.name,
    })
    .from(auditLogs)
    .leftJoin(actorUser, eq(actorUser.id, auditLogs.actorId))
    .where(and(eq(auditLogs.entity, "unit"), eq(auditLogs.entityId, unitId)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(100);
  return {
    unit: row,
    dimensions: project.dimensionConfig,
    history,
    permissions: { manage: canDoInventory(actor, "manage") },
  };
}
export type UnitDetail = Awaited<ReturnType<typeof getUnitDetail>>;

/** Projects for the inventory Project filter and the unit form (all statuses; inactive ones labelled). */
export async function inventoryProjects(db: Database) {
  const rows = await db
    .select({ id: projects.id, name: projects.name, status: projects.status, dimensionConfig: projects.dimensionConfig })
    .from(projects)
    .orderBy(asc(projects.status), asc(projects.name));
  return rows.map((p) => ({ ...p, label: p.status === "active" ? p.name : `${p.name} (inactive)` }));
}

/** Units per project (Projects KPI "Units tracked"). */
export async function unitCounts(db: Database) {
  const rows = await db.select({ projectId: units.projectId, n: count() }).from(units).groupBy(units.projectId);
  return new Map(rows.map((r) => [r.projectId, r.n]));
}
