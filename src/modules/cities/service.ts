import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { parse } from "@/modules/clients/support";
import { isUniqueViolation } from "@/modules/leads/support";
import type { Actor } from "@/server/auth/types";
import type { Database } from "@/server/db";
import { auditLogs, cities, clients, leads } from "@/server/db/schema";
import { AppError, notFound } from "@/server/errors";
import { assertCanManageCities } from "./policy";
import { createCitySchema, updateCitySchema } from "./validation";

const isId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Case-insensitive duplicates fail on the unique index, so two simultaneous saves can't both win. */
function duplicateOr(error: unknown) {
  if (isUniqueViolation(error)) {
    return new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { name: "This city is already on the list" } });
  }
  return error;
}

/** The whole list, inactive cities included, with how many records use each. */
export async function listCities(db: Database, actor: Actor) {
  assertCanManageCities(actor);
  const [rows, leadUse, clientUse] = await Promise.all([
    db
      .select({ id: cities.id, name: cities.name, isActive: cities.isActive })
      .from(cities)
      .orderBy(asc(cities.sortOrder), asc(cities.name)),
    db.select({ id: leads.cityId, n: count() }).from(leads).where(isNotNull(leads.cityId)).groupBy(leads.cityId),
    db.select({ id: clients.cityId, n: count() }).from(clients).where(isNotNull(clients.cityId)).groupBy(clients.cityId),
  ]);
  const leadCounts = new Map(leadUse.map((r) => [r.id, r.n]));
  const clientCounts = new Map(clientUse.map((r) => [r.id, r.n]));
  return rows.map((r) => ({ ...r, leads: leadCounts.get(r.id) ?? 0, clients: clientCounts.get(r.id) ?? 0 }));
}
export type CityRow = Awaited<ReturnType<typeof listCities>>[number];

export async function addCity(db: Database, actor: Actor, input: unknown) {
  assertCanManageCities(actor);
  const { name } = parse(createCitySchema, input);
  try {
    return await db.transaction(async (tx) => {
      const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${cities.sortOrder}), -1) + 1` }).from(cities);
      const [row] = await tx.insert(cities).values({ name, sortOrder: next }).returning({ id: cities.id });
      await tx.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: "city.add", entity: "city", entityId: row.id, after: { name } });
      return { cityId: row.id };
    });
  } catch (error) {
    throw duplicateOr(error);
  }
}

/**
 * Renames or switches a city on or off. Records point at the city's id, so a rename shows
 * everywhere and deactivating only stops new use. There is deliberately no delete.
 */
export async function updateCity(db: Database, actor: Actor, cityId: string, input: unknown) {
  assertCanManageCities(actor);
  if (!isId(cityId)) throw notFound("City");
  const data = parse(updateCitySchema, input);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.select().from(cities).where(eq(cities.id, cityId)).for("update");
      if (!row) throw notFound("City");
      const name = data.name ?? row.name;
      const isActive = data.isActive ?? row.isActive;
      if (name === row.name && isActive === row.isActive) return { changed: false };
      const log = (action: string, before: Record<string, unknown>, after: Record<string, unknown>) =>
        tx.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action, entity: "city", entityId: cityId, before, after });
      await tx.update(cities).set({ name, isActive }).where(eq(cities.id, cityId));
      if (name !== row.name) await log("city.rename", { name: row.name }, { name });
      if (isActive !== row.isActive) await log(isActive ? "city.activate" : "city.deactivate", { name, isActive: row.isActive }, { name, isActive });
      return { changed: true };
    });
  } catch (error) {
    throw duplicateOr(error);
  }
}

/**
 * Cities people typed under "Other" (owner review, 16 Nov 2026): grouped ignoring case and extra
 * spaces, most used first, showing one of the spellings used. Records that picked a list city are
 * not counted. Feeds the "Typed under Other" panel so common ones can be added to the list.
 */
export async function typedOtherCities(db: Database, actor: Actor, limit = 50) {
  assertCanManageCities(actor);
  const rows = await db.execute<{ name: string; leads: number; clients: number }>(sql`
    with typed as (
      select ${leads.cityOther} as raw, 1 as is_lead, 0 as is_client from ${leads} where ${leads.cityId} is null and ${leads.cityOther} is not null and ${leads.deletedAt} is null
      union all
      select ${clients.cityOther}, 0, 1 from ${clients} where ${clients.cityId} is null and ${clients.cityOther} is not null
    ), keyed as (
      select lower(regexp_replace(btrim(raw), '[[:space:]]+', ' ', 'g')) as k, btrim(raw) as raw, is_lead, is_client from typed where btrim(raw) <> ''
    )
    select (array_agg(raw order by raw))[1] as name, sum(is_lead)::int as leads, sum(is_client)::int as clients
    from keyed group by k order by count(*) desc, k limit ${limit}`);
  return (Array.isArray(rows) ? rows : rows.rows).map((r) => ({ name: r.name, leads: Number(r.leads), clients: Number(r.clients) }));
}
export type TypedOtherCity = Awaited<ReturnType<typeof typedOtherCities>>[number];

/**
 * "Add to list" for a typed city: creates the city and points every lead and client that typed the
 * same name (ignoring case and extra spaces) at it, in one transaction. Audited with the counts.
 */
export async function addTypedCity(db: Database, actor: Actor, input: unknown) {
  assertCanManageCities(actor);
  const { name } = parse(createCitySchema, input);
  const sameName = (column: typeof leads.cityOther | typeof clients.cityOther) => sql`lower(regexp_replace(btrim(${column}), '[[:space:]]+', ' ', 'g')) = ${name.toLowerCase()}`;
  try {
    return await db.transaction(async (tx) => {
      const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${cities.sortOrder}), -1) + 1` }).from(cities);
      const [row] = await tx.insert(cities).values({ name, sortOrder: next }).returning({ id: cities.id });
      const linkedLeads = await tx.update(leads).set({ cityId: row.id, cityOther: null }).where(and(isNull(leads.cityId), sameName(leads.cityOther))).returning({ id: leads.id });
      const linkedClients = await tx.update(clients).set({ cityId: row.id, cityOther: null }).where(and(isNull(clients.cityId), sameName(clients.cityOther))).returning({ id: clients.id });
      await tx.insert(auditLogs).values({
        actorId: actor.id,
        ip: actor.ip ?? null,
        action: "city.add_from_other",
        entity: "city",
        entityId: row.id,
        after: { name, linkedLeads: linkedLeads.length, linkedClients: linkedClients.length },
      });
      return { cityId: row.id, linkedLeads: linkedLeads.length, linkedClients: linkedClients.length };
    });
  } catch (error) {
    throw duplicateOr(error);
  }
}
