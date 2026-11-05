import { asc, count, eq, isNotNull, sql } from "drizzle-orm";
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
