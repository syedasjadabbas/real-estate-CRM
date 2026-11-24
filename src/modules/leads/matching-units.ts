import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/server/db";
import { units } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { canDoInventory } from "@/modules/inventory/policy";

/** How far a unit's area may be from the size asked for. */
export const SIZE_TOLERANCE = 0.1;
const LIMIT = 8;

/** Available units in the project within 10% of the size, closest first. */
export async function matchingUnits(db: Database, actor: Actor, lead: { projectId: string; sizeSqft: number | null }) {
  if (!lead.sizeSqft || !canDoInventory(actor, "view")) return { total: 0, rows: [] };
  const where = and(
    eq(units.projectId, lead.projectId),
    eq(units.status, "available"),
    isNull(units.archivedAt),
    sql`${units.areaSqft} between ${lead.sizeSqft * (1 - SIZE_TOLERANCE)} and ${lead.sizeSqft * (1 + SIZE_TOLERANCE)}`,
  );
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(units).where(where),
    db
      .select({ id: units.id, unitNo: units.unitNo, areaSqft: units.areaSqft, basePrice: units.basePrice, nature: units.nature, floor: units.floor })
      .from(units)
      .where(where)
      .orderBy(sql`abs(${units.areaSqft} - ${lead.sizeSqft})`, asc(units.unitNo))
      .limit(LIMIT),
  ]);
  return { total, rows };
}
