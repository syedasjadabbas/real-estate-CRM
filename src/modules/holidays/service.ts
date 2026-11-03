import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/server/db";
import { auditLogs, holidays, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { notFound } from "@/server/errors";
import { businessToday } from "@/modules/bookings/today";
import { isUniqueViolation, type DbOrTx } from "@/modules/leads/support";
import { parseTask as parse, taskFieldError as fieldError } from "@/modules/tasks/support";
import { assertCanManageHolidays, assertCanViewHolidays } from "./policy";
import { createHolidaySchema, holidayListQuerySchema, regionIssue, updateHolidaySchema, type HolidayScope } from "./validation";

const UNIQUE = "holidays_date_scope_region_uq";
const duplicateMessage = (scope: HolidayScope) => (scope === "regional" ? "This region already has a holiday on this date" : "A company-wide holiday already exists on this date");

async function audit(tx: DbOrTx, actor: Actor, action: string, entityId: string, before: unknown, after: unknown) {
  await tx.insert(auditLogs).values({ actorId: actor.id, action: `holiday.${action}`, entity: "holiday", entityId, before: before ?? null, after: after ?? null });
}

/** Friendly duplicate check; the unique index is the final guard against races. */
async function checkFree(tx: DbOrTx, next: { date: string; scope: HolidayScope; region: string | null }, exceptId?: string) {
  const [clash] = await tx
    .select({ id: holidays.id })
    .from(holidays)
    .where(
      and(
        eq(holidays.date, next.date),
        eq(holidays.scope, next.scope),
        sql`lower(coalesce(${holidays.region}, '')) = lower(${next.region ?? ""})`,
        exceptId ? ne(holidays.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (clash) throw fieldError("date", duplicateMessage(next.scope));
}

async function guardUnique<T>(scope: HolidayScope, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (error) {
    if (isUniqueViolation(error, UNIQUE)) throw fieldError("date", duplicateMessage(scope));
    throw error;
  }
}

async function loadHoliday(tx: DbOrTx, holidayId: string, forUpdate = false) {
  if (!/^[0-9a-f-]{36}$/i.test(holidayId)) throw notFound("Holiday");
  const query = tx.select().from(holidays).where(eq(holidays.id, holidayId)).limit(1);
  const [row] = forUpdate ? await query.for("update") : await query;
  if (!row) throw notFound("Holiday");
  return row;
}

const snapshot = (h: { date: string; name: string; scope: HolidayScope; region: string | null }) => ({ date: h.date, name: h.name, scope: h.scope, region: h.region });

/** FR-141 create (HR / admins). */
export async function createHoliday(db: Database, actor: Actor, input: unknown) {
  assertCanManageHolidays(actor);
  const data = parse(createHolidaySchema, input);
  return guardUnique(data.scope, () =>
    db.transaction(async (tx) => {
      await checkFree(tx, data);
      const [row] = await tx
        .insert(holidays)
        .values({ ...snapshot(data), createdById: actor.id, updatedById: actor.id })
        .returning({ id: holidays.id });
      await audit(tx, actor, "create", row.id, null, snapshot(data));
      return { holidayId: row.id };
    }),
  );
}

export async function updateHoliday(db: Database, actor: Actor, holidayId: string, input: unknown) {
  assertCanManageHolidays(actor);
  const data = parse(updateHolidaySchema, input);
  return db.transaction(async (tx) => {
    const current = await loadHoliday(tx, holidayId, true);
    const next = {
      date: data.date ?? current.date,
      name: data.name ?? current.name,
      scope: data.scope ?? current.scope,
      region: "region" in data ? (data.region ?? null) : current.region,
    };
    const issue = regionIssue(next.scope, next.region);
    if (issue) throw fieldError("region", issue);
    const changed = (["date", "name", "scope", "region"] as const).filter((k) => next[k] !== current[k]);
    if (changed.length === 0) return { changed: [] as string[] };
    await checkFree(tx, next, current.id);
    await guardUnique(next.scope, () =>
      tx.update(holidays).set({ ...next, updatedById: actor.id, updatedAt: new Date() }).where(eq(holidays.id, current.id)),
    );
    await audit(
      tx,
      actor,
      "update",
      current.id,
      Object.fromEntries(changed.map((k) => [k, current[k]])),
      Object.fromEntries(changed.map((k) => [k, next[k]])),
    );
    return { changed };
  });
}

/** API_DESIGN `DELETE /holidays/:id`: removed from the calendar; the audit log keeps the record. */
export async function deleteHoliday(db: Database, actor: Actor, holidayId: string) {
  assertCanManageHolidays(actor);
  return db.transaction(async (tx) => {
    const current = await loadHoliday(tx, holidayId, true);
    await tx.delete(holidays).where(eq(holidays.id, current.id));
    await audit(tx, actor, "delete", current.id, snapshot(current), null);
    return { deleted: true };
  });
}

export type HolidayRow = { id: string; date: string; name: string; scope: HolidayScope; region: string | null; updatedAt: Date; updatedBy: string | null };

/**
 * Holidays of one calendar year with filters (scope, region, search). A year holds a handful of
 * rows, so the list is not paginated. Tiles count the whole year; "next" ignores the filters.
 */
export async function listHolidays(db: Database, actor: Actor, input: unknown = {}) {
  assertCanViewHolidays(actor);
  const query = holidayListQuerySchema.parse(input ?? {});
  const today = businessToday();
  const year = query.year ?? Number(today.slice(0, 4));
  const inYear = and(gte(holidays.date, `${year}-01-01`), lte(holidays.date, `${year}-12-31`));
  const term = query.q ? `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const filters: (SQL | undefined)[] = [
    inYear,
    query.scope ? eq(holidays.scope, query.scope) : undefined,
    query.region ? sql`lower(${holidays.region}) = lower(${query.region})` : undefined,
    term ? or(ilike(holidays.name, term), ilike(holidays.region, term)) : undefined,
  ];
  const direction = query.dir === "desc" ? desc : asc;
  const order = query.sort === "name" ? [direction(sql`lower(${holidays.name})`), asc(holidays.date)] : [direction(holidays.date), asc(sql`lower(${holidays.name})`)];

  const [rows, [tiles], [next], regionRows] = await Promise.all([
    db
      .select({
        id: holidays.id,
        date: holidays.date,
        name: holidays.name,
        scope: holidays.scope,
        region: holidays.region,
        updatedAt: holidays.updatedAt,
        updatedBy: users.name,
      })
      .from(holidays)
      .leftJoin(users, eq(users.id, holidays.updatedById))
      .where(and(...filters))
      .orderBy(...order),
    db
      .select({
        total: sql<number>`count(*)::int`,
        company: sql<number>`count(*) filter (where ${holidays.scope} = 'company')::int`,
        regional: sql<number>`count(*) filter (where ${holidays.scope} = 'regional')::int`,
        upcoming: sql<number>`count(*) filter (where ${holidays.date} >= ${today})::int`,
      })
      .from(holidays)
      .where(inYear),
    db
      .select({ date: holidays.date, name: holidays.name, scope: holidays.scope, region: holidays.region })
      .from(holidays)
      .where(gte(holidays.date, today))
      .orderBy(asc(holidays.date), asc(holidays.name))
      .limit(1),
    db
      .selectDistinct({ region: holidays.region })
      .from(holidays)
      .where(isNotNull(holidays.region))
      .orderBy(asc(holidays.region)),
  ]);

  // Regions are free text: offer each spelling once, case-insensitively.
  const regions = [...new Map(regionRows.map((r) => [r.region!.toLowerCase(), r.region!])).values()];
  return { year, today, query, rows: rows as HolidayRow[], tiles, next: next ?? null, regions };
}

export const UPCOMING_HOLIDAY_LIMIT = 10;

/** Whole days from `from` to `to` (YYYY-MM-DD calendar dates, no time zone drift). */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Next holidays from today (business time) for My Workplace. Every signed-in role may see the dates
 * (HR plan §5), so there is no role check here; the HR Holidays page keeps `canViewHolidays`.
 * Company-wide and regional dates are both returned: employees have no region yet (Q9).
 * Only calendar facts are returned, never who created or edited a holiday.
 */
/**
 * Upcoming holidays. With `regions` (questionnaire Q5: region from the person's teams), regional
 * holidays are limited to those regions (ignoring case); without, every regional holiday is listed.
 */
export async function upcomingHolidays(db: Database, { limit = UPCOMING_HOLIDAY_LIMIT, today = businessToday(), regions = null as string[] | null } = {}) {
  const regionFilter = regions === null ? undefined : regions.length ? or(eq(holidays.scope, "company"), inArray(sql`lower(${holidays.region})`, regions.map((r) => r.toLowerCase()))) : eq(holidays.scope, "company");
  const rows = await db
    .select({ id: holidays.id, date: holidays.date, name: holidays.name, scope: holidays.scope, region: holidays.region })
    .from(holidays)
    .where(and(gte(holidays.date, today), regionFilter))
    .orderBy(asc(holidays.date), asc(holidays.scope), asc(sql`lower(${holidays.name})`))
    .limit(limit);
  return { today, rows: rows.map((r) => ({ ...r, daysAway: daysBetween(today, r.date) })) };
}
export type UpcomingHoliday = Awaited<ReturnType<typeof upcomingHolidays>>["rows"][number];
