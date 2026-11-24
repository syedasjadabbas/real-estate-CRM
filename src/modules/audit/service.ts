import { and, asc, desc, eq, gte, ilike, isNotNull, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/server/db";
import { auditLogs, leads, users } from "@/server/db/schema";
import { ROLE_LABELS, type Actor, type Role } from "@/server/auth/types";
import { forbidden } from "@/server/errors";
import { toCsv } from "@/server/csv";
import { ACTION_LABELS, ENTITY_LABELS, actionLabel, entityLabel } from "./labels";
import { recordNames, type RecordRef } from "./records";
import { inArray } from "drizzle-orm";

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
  /** A lead's code, name or phone: that lead, its bookings, payments, meetings and tasks. */
  lead: z.string().trim().max(100).optional().catch(undefined),
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
  /** The record's name and page, when it still exists (16 Nov 2026). */
  record: RecordRef | null;
};

const SORTS: Record<AuditSortColumn, SQL> = {
  time: sql`${auditLogs.createdAt}`,
  actor: sql`lower(${users.name})`,
  action: sql`${auditLogs.action}`,
  entity: sql`${auditLogs.entity}`,
};

const LEAD_MATCH_LIMIT = 50;
export type AuditLeadMatch = { id: string; name: string; code: string };

/** The leads the Lead filter means: an exact code wins; otherwise names and numbers containing the text. */
async function matchLeads(db: Database, text: string | undefined): Promise<AuditLeadMatch[] | null> {
  if (!text) return null;
  const columns = { id: leads.id, name: leads.name, code: leads.code };
  const exact = await db.select(columns).from(leads).where(sql`upper(${leads.code}) = ${text.toUpperCase()}`).limit(1);
  if (exact.length) return exact;
  const like = `%${text.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const digits = text.replace(/\D/g, "").replace(/^0+/, "");
  return db
    .select(columns)
    .from(leads)
    .where(or(ilike(leads.name, like), ilike(leads.code, like), digits.length >= 4 && /^[\d\s+()-]+$/.test(text) ? ilike(leads.phoneE164, `%${digits}%`) : undefined))
    .orderBy(asc(leads.name), asc(leads.code))
    .limit(LEAD_MATCH_LIMIT);
}

/** Entries about these leads and the records that belong to them. */
function aboutLeads(ids: string[]): SQL {
  if (ids.length === 0) return sql`false`;
  const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  return sql`(
    (${auditLogs.entity} = 'lead' and ${auditLogs.entityId} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}))
    or (${auditLogs.entity} = 'booking' and ${auditLogs.entityId} in (select id::text from bookings where lead_id in (${list})))
    or (${auditLogs.entity} = 'payment' and ${auditLogs.entityId} in (select p.id::text from booking_payments p join bookings b on b.id = p.booking_id where b.lead_id in (${list})))
    or (${auditLogs.entity} = 'meeting' and ${auditLogs.entityId} in (select id::text from meetings where lead_id in (${list})))
    or (${auditLogs.entity} = 'task' and ${auditLogs.entityId} in (select id::text from tasks where lead_id in (${list})))
  )`;
}

/** The WHERE clause for the filters; shared by the page and the CSV download. */
function auditWhere(query: AuditQuery, matched: AuditLeadMatch[] | null) {
  const term = query.q ? `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const needle = query.q?.toLowerCase() ?? "";
  const labelActions = needle ? Object.entries(ACTION_LABELS).filter(([, l]) => l.toLowerCase().includes(needle)).map(([code]) => code) : [];
  const labelEntities = needle ? Object.entries(ENTITY_LABELS).filter(([, l]) => l.toLowerCase().includes(needle)).map(([code]) => code) : [];
  return and(
    matched ? aboutLeads(matched.map((l) => l.id)) : undefined,
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
          labelActions.length ? inArray(auditLogs.action, labelActions) : undefined,
          labelEntities.length ? inArray(auditLogs.entity, labelEntities) : undefined,
        )
      : undefined,
  );
}

/** Filtered, sorted, 50-per-page audit rows, plus the values the filters offer. */
export async function listAuditLogs(db: Database, actor: Actor, rawQuery: unknown = {}) {
  if (!canViewAuditLog(actor)) throw forbidden();
  const query = auditQuery.parse(rawQuery ?? {});
  const matched = await matchLeads(db, query.lead);
  const where = auditWhere(query, matched);
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
    rows: await withRecords(db, rows),
    /** Null without the Lead filter. */
    leadMatches: matched,
    leadMatchLimit: LEAD_MATCH_LIMIT,
    options: { entities, actions, actors },
  };
}

type RawAuditRow = Omit<AuditRow, "record">;

/** Secrets hidden, and each row's record named (one lookup per record type). */
async function withRecords(db: Database, rows: RawAuditRow[]): Promise<AuditRow[]> {
  const names = await recordNames(db, rows);
  return rows.map((r) => ({ ...r, before: redactSecrets(r.before), after: redactSecrets(r.after), record: names.get(r.entity, r.entityId) }));
}

export const AUDIT_EXPORT_LIMIT = 20_000;
const karachi = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const pkTime = (d: Date) => karachi.format(d).replace(",", "");
const json = (v: unknown) => (v === null || v === undefined ? "" : JSON.stringify(v));

/**
 * Audit log download (owner review, 16 Nov 2026): every entry matching the page's filters, newest
 * first, up to 20,000 rows, with plain labels beside the codes. Downloading it is itself logged.
 */
export async function auditLogCsv(db: Database, actor: Actor & { ip?: string | null }, rawQuery: unknown = {}) {
  if (!canViewAuditLog(actor)) throw forbidden();
  const query = auditQuery.parse(rawQuery ?? {});
  const raw = await db
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
    .where(auditWhere(query, await matchLeads(db, query.lead)))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(AUDIT_EXPORT_LIMIT);
  const rows = await withRecords(db, raw);
  const body = toCsv(
    ["Time (Pakistan)", "User", "Role", "Action", "Action code", "Record type", "Record", "Record ID", "Before", "After", "IP"],
    rows.map((r) => [
      pkTime(r.createdAt),
      r.actorName ?? "System",
      r.actorRole ? (ROLE_LABELS[r.actorRole as Role] ?? r.actorRole) : "",
      actionLabel(r.action),
      r.action,
      entityLabel(r.entity),
      r.record?.name ?? "",
      r.entityId ?? "",
      json(r.before),
      json(r.after),
      r.ip ?? "",
    ]),
  );
  const filename = `audit-log-${query.from ?? "start"}-to-${query.to ?? pkTime(new Date()).slice(0, 10)}.csv`;
  await db.insert(auditLogs).values({
    actorId: actor.id,
    ip: actor.ip ?? null,
    action: "audit.export",
    entity: "audit_log",
    entityId: null,
    before: null,
    after: { file: filename, rows: rows.length, filters: Object.fromEntries(Object.entries({ q: query.q, lead: query.lead, actor: query.actor, entity: query.entity, action: query.action, from: query.from, to: query.to }).filter(([, v]) => v)) },
  });
  return { filename, body, rows: rows.length };
}
