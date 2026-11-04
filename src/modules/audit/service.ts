import { and, asc, desc, eq, gte, ilike, isNotNull, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/server/db";
import { auditLogs, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { forbidden } from "@/server/errors";

/**
 * Audit-log viewer (FR-008, SECURITY_AND_PRIVACY §3: "Admins can view audit logs. Nobody can edit or
 * delete them through the app"). Read-only: this module has no write path, and no route offers one.
 * Access follows USER_ROLES_AND_PERMISSIONS "Audit log": Super Admin and Admin, every record.
 */
export const canViewAuditLog = (actor: Pick<Actor, "role">) => actor.role === "super_admin" || actor.role === "admin";

export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_SORT_COLUMNS = ["time", "actor", "action", "entity"] as const;
export type AuditSortColumn = (typeof AUDIT_SORT_COLUMNS)[number];
const OFFSET = "+05:00"; // Asia/Karachi (business dates), no daylight saving
const DAY = 86_400_000;
const isoDate = z.iso.date().optional().catch(undefined);

const auditQuery = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  actor: z.uuid().optional().catch(undefined),
  entity: z.string().trim().regex(/^[a-z_]{1,40}$/).optional().catch(undefined),
  action: z.string().trim().regex(/^[a-z_.]{1,80}$/).optional().catch(undefined),
  from: isoDate,
  to: isoDate,
  sort: z.enum(AUDIT_SORT_COLUMNS).catch("time"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
});
export type AuditQuery = z.infer<typeof auditQuery>;

/**
 * Keys never shown, whatever a future command writes (defence in depth: no command stores them today).
 * Business fields such as `tokenAmount` (a booking's token payment) are not secrets and stay.
 */
const SECRET_KEY = /^(password|password_?hash|new_?password|token|token_?hash|session_?token|secret|.*_secret|.*Secret|api_?key|cookie|authorization)$/i;
export const REDACTED = "[hidden]";
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? REDACTED : redactSecrets(v)]));
  }
  return value;
}

export type AuditRow = {
  id: string;
  createdAt: Date;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
};

const SORTS: Record<AuditSortColumn, SQL> = {
  time: sql`${auditLogs.createdAt}`,
  actor: sql`lower(${users.name})`,
  action: sql`${auditLogs.action}`,
  entity: sql`${auditLogs.entity}`,
};

/** Filtered, sorted, 50-per-page audit rows, plus the values the filters offer. */
export async function listAuditLogs(db: Database, actor: Actor, rawQuery: unknown = {}) {
  if (!canViewAuditLog(actor)) throw forbidden();
  const query = auditQuery.parse(rawQuery ?? {});
  const term = query.q ? `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const where = and(
    query.actor ? eq(auditLogs.actorId, query.actor) : undefined,
    query.entity ? eq(auditLogs.entity, query.entity) : undefined,
    query.action ? eq(auditLogs.action, query.action) : undefined,
    query.from ? gte(auditLogs.createdAt, new Date(`${query.from}T00:00:00${OFFSET}`)) : undefined,
    query.to ? lt(auditLogs.createdAt, new Date(new Date(`${query.to}T00:00:00${OFFSET}`).getTime() + DAY)) : undefined,
    term
      ? or(
          ilike(auditLogs.action, term),
          ilike(auditLogs.entity, term),
          ilike(auditLogs.entityId, term),
          ilike(auditLogs.ip, term),
          ilike(users.name, term),
          sql`${auditLogs.before}::text ilike ${term}`,
          sql`${auditLogs.after}::text ilike ${term}`,
        )
      : undefined,
  );
  // Sequential on purpose: small queries, and one connection is enough.
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorId)).where(where);
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  const column = SORTS[query.sort];
  const rows = await db
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      actorId: auditLogs.actorId,
      actorName: users.name,
      actorRole: users.role,
      action: auditLogs.action,
      entity: auditLogs.entity,
      entityId: auditLogs.entityId,
      before: auditLogs.before,
      after: auditLogs.after,
      ip: auditLogs.ip,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(where)
    .orderBy(query.dir === "asc" ? sql`${column} asc nulls first` : sql`${column} desc nulls last`, desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(AUDIT_PAGE_SIZE)
    .offset((page - 1) * AUDIT_PAGE_SIZE);

  const entities = (await db.selectDistinct({ v: auditLogs.entity }).from(auditLogs).orderBy(asc(auditLogs.entity))).map((r) => r.v);
  const actions = (
    await db
      .selectDistinct({ v: auditLogs.action })
      .from(auditLogs)
      .where(query.entity ? eq(auditLogs.entity, query.entity) : undefined)
      .orderBy(asc(auditLogs.action))
  ).map((r) => r.v);
  const actors = await db
    .selectDistinct({ id: users.id, name: users.name })
    .from(auditLogs)
    .innerJoin(users, eq(users.id, auditLogs.actorId))
    .where(isNotNull(auditLogs.actorId))
    .orderBy(users.name, users.id);

  return {
    query: { ...query, page },
    total,
    page,
    pageCount,
    rows: rows.map((r) => ({ ...r, before: redactSecrets(r.before), after: redactSecrets(r.after) })) as AuditRow[],
    options: { entities, actions, actors },
  };
}
