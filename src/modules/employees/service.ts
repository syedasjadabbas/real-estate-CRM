import { and, asc, count, desc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/server/db";
import { auditLogs, employeeProfiles, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, notFound } from "@/server/errors";
import { formatPhone } from "@/modules/leads/phone";
import { parseTask as parse } from "@/modules/tasks/support";
import { assertCanEditEmployeeProfiles, assertCanViewEmployees } from "./policy";
import { EMPLOYEE_PAGE_SIZE, employeeListQuerySchema, profileSchema, recordSchema } from "./validation";

const editor = alias(users, "profile_editor");
const historyActor = alias(users, "history_actor");

/** A profile counts as completed when every FR-140 HR field is filled. */
const completed = sql<boolean>`(${employeeProfiles.designation} is not null and ${employeeProfiles.department} is not null and ${employeeProfiles.phoneE164} is not null and ${employeeProfiles.joiningDate} is not null)`;

/** Accounts and records without a login, as one row each (users FULL JOIN employee_profiles). */
const empId = sql<string>`coalesce(${users.id}, ${employeeProfiles.id})`;
const empName = sql<string>`coalesce(${users.name}, ${employeeProfiles.fullName})`;
const empEmail = sql<string | null>`coalesce(${users.email}, ${employeeProfiles.email})`;
const empStatus = sql<"active" | "inactive">`coalesce(${users.status}, ${employeeProfiles.status})`;

const SORTS = {
  name: sql`lower(${empName})`,
  designation: sql`lower(${employeeProfiles.designation})`,
  department: sql`lower(${employeeProfiles.department})`,
  role: users.role,
  joiningDate: employeeProfiles.joiningDate,
  status: empStatus,
};

const phoneOf = (p: { phoneCountryCode: string | null; phoneNumber: string | null }) =>
  p.phoneCountryCode && p.phoneNumber ? formatPhone(p.phoneCountryCode, p.phoneNumber) : null;

/** Distinct free-text values, one per case-insensitive spelling, for suggestions and filters. */
async function distinctValues(db: Database, column: typeof employeeProfiles.department | typeof employeeProfiles.designation) {
  const rows = await db.selectDistinct({ v: column }).from(employeeProfiles).where(isNotNull(column)).orderBy(asc(column));
  return [...new Map(rows.map((r) => [r.v!.toLowerCase(), r.v!])).values()];
}

export async function employeeSuggestions(db: Database) {
  const [departments, designations] = await Promise.all([distinctValues(db, employeeProfiles.department), distinctValues(db, employeeProfiles.designation)]);
  return { departments, designations };
}

/**
 * Employees directory (FR-140): every CRM account with its HR profile, plus HR records for staff
 * without a CRM login (questionnaire Q1).
 */
export async function listEmployees(db: Database, actor: Actor, input: unknown = {}) {
  assertCanViewEmployees(actor);
  const query = employeeListQuerySchema.parse(input ?? {});
  const term = query.q ? `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const where = and(
    query.role === "none" ? sql`${users.id} is null` : query.role ? eq(users.role, query.role) : undefined,
    query.status ? sql`${empStatus} = ${query.status}` : undefined,
    query.department ? sql`lower(${employeeProfiles.department}) = lower(${query.department})` : undefined,
    term ? or(ilike(empName, term), ilike(empEmail, term), ilike(employeeProfiles.designation, term), ilike(employeeProfiles.department, term)) : undefined,
  );
  const base = () => db.select({ total: count() }).from(users).fullJoin(employeeProfiles, eq(employeeProfiles.userId, users.id));
  const [[{ total }], [tiles], suggestions] = await Promise.all([
    base().where(where),
    db
      .select({
        accounts: sql<number>`count(${users.id})::int`,
        active: sql<number>`count(*) filter (where ${users.status} = 'active')::int`,
        inactive: sql<number>`count(*) filter (where ${users.status} = 'inactive')::int`,
        noLogin: sql<number>`count(*) filter (where ${users.id} is null)::int`,
        completed: sql<number>`count(*) filter (where ${completed})::int`,
      })
      .from(users)
      .fullJoin(employeeProfiles, eq(employeeProfiles.userId, users.id)),
    employeeSuggestions(db),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / EMPLOYEE_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  const column = SORTS[query.sort];
  const order = query.dir === "asc" ? sql`${column} asc nulls last` : sql`${column} desc nulls last`;
  const rows = await db
    .select({
      id: empId,
      name: empName,
      email: empEmail,
      role: users.role,
      status: empStatus,
      hasLogin: sql<boolean>`${users.id} is not null`,
      designation: employeeProfiles.designation,
      department: employeeProfiles.department,
      phoneCountryCode: employeeProfiles.phoneCountryCode,
      phoneNumber: employeeProfiles.phoneNumber,
      joiningDate: employeeProfiles.joiningDate,
    })
    .from(users)
    .fullJoin(employeeProfiles, eq(employeeProfiles.userId, users.id))
    .where(where)
    .orderBy(order, asc(sql`lower(${empName})`), asc(empId))
    .limit(EMPLOYEE_PAGE_SIZE)
    .offset((page - 1) * EMPLOYEE_PAGE_SIZE);
  return {
    query: { ...query, page },
    total,
    page,
    pageCount,
    tiles,
    departments: suggestions.departments,
    rows: rows.map(({ phoneCountryCode, phoneNumber, ...r }) => ({ ...r, phone: phoneOf({ phoneCountryCode, phoneNumber }) })),
  };
}
export type EmployeeRow = Awaited<ReturnType<typeof listEmployees>>["rows"][number];

/**
 * One employee by CRM user id, or by HR record id for staff without a login: account facts
 * (read-only), HR profile and its change history.
 */
export async function getEmployee(db: Database, actor: Actor, id: string) {
  assertCanViewEmployees(actor);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Employee");
  const [row] = await db
    .select({
      id: empId,
      profileId: employeeProfiles.id,
      hasLogin: sql<boolean>`${users.id} is not null`,
      name: empName,
      email: empEmail,
      role: users.role,
      status: empStatus,
      createdAt: sql<string>`coalesce(${users.createdAt}, ${employeeProfiles.createdAt})`,
      designation: employeeProfiles.designation,
      department: employeeProfiles.department,
      phoneCountryCode: employeeProfiles.phoneCountryCode,
      phoneNumber: employeeProfiles.phoneNumber,
      joiningDate: employeeProfiles.joiningDate,
      profileUpdatedAt: employeeProfiles.updatedAt,
      profileUpdatedBy: editor.name,
    })
    .from(users)
    .fullJoin(employeeProfiles, eq(employeeProfiles.userId, users.id))
    .leftJoin(editor, eq(editor.id, employeeProfiles.updatedById))
    .where(or(eq(users.id, id), and(eq(employeeProfiles.id, id), sql`${employeeProfiles.userId} is null`)))
    .limit(1);
  if (!row) throw notFound("Employee");
  const history = await db
    .select({ id: auditLogs.id, before: auditLogs.before, after: auditLogs.after, createdAt: auditLogs.createdAt, actorName: historyActor.name })
    .from(auditLogs)
    .leftJoin(historyActor, eq(historyActor.id, auditLogs.actorId))
    // A record later linked to an account keeps its earlier history (audited under the record id).
    .where(and(eq(auditLogs.entity, "employee_profile"), or(eq(auditLogs.entityId, row.id), eq(auditLogs.entityId, row.profileId ?? row.id))))
    .orderBy(desc(auditLogs.createdAt))
    .limit(50);
  return { employee: { ...row, createdAt: new Date(row.createdAt), phone: phoneOf(row) }, history };
}

const FIELDS = ["designation", "department", "phoneCountryCode", "phoneNumber", "phoneE164", "joiningDate"] as const;

/**
 * Saves HR profile fields (super admin, admin, HR). Creates the profile on first save; only
 * changed fields are written and audited. Account data on `users` is never touched.
 */
export async function saveEmployeeProfile(db: Database, actor: Actor, userId: string, input: unknown) {
  assertCanEditEmployeeProfiles(actor);
  const data = parse(profileSchema, input);
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw notFound("Employee");
  return db.transaction(async (tx) => {
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1).for("share");
    if (!user) throw notFound("Employee");
    const [current] = await tx.select().from(employeeProfiles).where(eq(employeeProfiles.userId, userId)).limit(1).for("update");
    const before = {
      designation: current?.designation ?? null,
      department: current?.department ?? null,
      phoneCountryCode: current?.phoneCountryCode ?? null,
      phoneNumber: current?.phoneNumber ?? null,
      phoneE164: current?.phoneE164 ?? null,
      joiningDate: current?.joiningDate ?? null,
    };
    const next = { ...before };
    if ("designation" in data) next.designation = data.designation ?? null;
    if ("department" in data) next.department = data.department ?? null;
    if ("joiningDate" in data) next.joiningDate = data.joiningDate ?? null;
    if ("phone" in data) {
      next.phoneCountryCode = data.phone?.countryCode ?? null;
      next.phoneNumber = data.phone?.national ?? null;
      next.phoneE164 = data.phone?.e164 ?? null;
    }
    const changed = FIELDS.filter((k) => next[k] !== before[k]);
    if (changed.length === 0) return { changed: [] as string[] };
    const now = new Date();
    await tx
      .insert(employeeProfiles)
      .values({ userId, ...next, updatedById: actor.id })
      .onConflictDoUpdate({ target: employeeProfiles.userId, set: { ...next, updatedById: actor.id, updatedAt: now } });
    await tx.insert(auditLogs).values({
      actorId: actor.id,
      action: current ? "employee.profile_update" : "employee.profile_create",
      entity: "employee_profile",
      entityId: userId,
      before: Object.fromEntries(changed.map((k) => [k, before[k]])),
      after: Object.fromEntries(changed.map((k) => [k, next[k]])),
    });
    return { changed: changed as string[] };
  });
}

const RECORD_FIELDS = ["fullName", "email", "status", ...FIELDS] as const;
type RecordValues = Record<(typeof RECORD_FIELDS)[number], string | null>;

function applyRecordInput(base: RecordValues, data: ReturnType<typeof recordSchema.parse>) {
  const next = { ...base };
  if (data.fullName !== undefined) next.fullName = data.fullName;
  if ("email" in data) next.email = data.email ?? null;
  if (data.status) next.status = data.status;
  if ("designation" in data) next.designation = data.designation ?? null;
  if ("department" in data) next.department = data.department ?? null;
  if ("joiningDate" in data) next.joiningDate = data.joiningDate ?? null;
  if ("phone" in data) {
    next.phoneCountryCode = data.phone?.countryCode ?? null;
    next.phoneNumber = data.phone?.national ?? null;
    next.phoneE164 = data.phone?.e164 ?? null;
  }
  return next;
}

/** Adds an HR record for a staff member without a CRM login (Q1; super admin, admin, HR). */
export async function createEmployeeRecord(db: Database, actor: Actor, input: unknown) {
  assertCanEditEmployeeProfiles(actor);
  const data = parse(recordSchema, input);
  if (!data.fullName) throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { fullName: "Enter a name" } });
  const empty = Object.fromEntries(RECORD_FIELDS.map((k) => [k, null])) as RecordValues;
  const next = applyRecordInput({ ...empty, status: "active" }, data);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(employeeProfiles)
      .values({ ...next, fullName: next.fullName!, status: next.status as "active" | "inactive", updatedById: actor.id })
      .returning({ id: employeeProfiles.id });
    await tx.insert(auditLogs).values({
      actorId: actor.id,
      action: "employee.record_create",
      entity: "employee_profile",
      entityId: row.id,
      before: null,
      after: Object.fromEntries(RECORD_FIELDS.filter((k) => next[k] !== null).map((k) => [k, next[k]])),
    });
    return { id: row.id };
  });
}

/** Edits an HR record without a CRM login: name, email, employment status and profile fields. */
export async function saveEmployeeRecord(db: Database, actor: Actor, profileId: string, input: unknown) {
  assertCanEditEmployeeProfiles(actor);
  const data = parse(recordSchema, input);
  if (!/^[0-9a-f-]{36}$/i.test(profileId)) throw notFound("Employee");
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(employeeProfiles)
      .where(and(eq(employeeProfiles.id, profileId), sql`${employeeProfiles.userId} is null`))
      .limit(1)
      .for("update");
    if (!current) throw notFound("Employee");
    const before = Object.fromEntries(RECORD_FIELDS.map((k) => [k, (current[k] as string | null) ?? null])) as RecordValues;
    const next = applyRecordInput(before, data);
    const changed = RECORD_FIELDS.filter((k) => next[k] !== before[k]);
    if (!changed.length) return { changed: [] as string[] };
    await tx
      .update(employeeProfiles)
      .set({ ...next, fullName: next.fullName!, status: next.status as "active" | "inactive", updatedById: actor.id, updatedAt: new Date() })
      .where(eq(employeeProfiles.id, profileId));
    await tx.insert(auditLogs).values({
      actorId: actor.id,
      action: "employee.record_update",
      entity: "employee_profile",
      entityId: profileId,
      before: Object.fromEntries(changed.map((k) => [k, before[k]])),
      after: Object.fromEntries(changed.map((k) => [k, next[k]])),
    });
    return { changed: changed as string[] };
  });
}
