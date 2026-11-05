import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/modules/leads/support";
import type { Database } from "@/server/db";
import { cities } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { OTHER_CITY } from "./constants";
import { cityNameSchema } from "./validation";

const invalid = (field: "cityId" | "cityOther", message: string) =>
  new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { [field]: message } });

/**
 * What a lead or client stores for a city choice (FR-042). A list city must exist and be active,
 * though a record may keep the inactive city it already has. A typed name must pass the city
 * name rule, and one matching an active list city uses that city, so the list stays the source.
 * Only choosing "Other" reads the text, so a name left in the form after switching away is ignored.
 */
export async function resolveCity(
  db: Database | Tx,
  data: { cityId?: string; cityOther?: string },
  current?: { cityId: string | null },
): Promise<{ cityId: string | null; cityOther: string | null }> {
  if (data.cityId && data.cityId !== OTHER_CITY) {
    const [city] = await db.select({ isActive: cities.isActive }).from(cities).where(eq(cities.id, data.cityId));
    if (!city) throw invalid("cityId", "Choose a city from the list");
    if (!city.isActive && data.cityId !== current?.cityId) throw invalid("cityId", "This city is no longer available");
    return { cityId: data.cityId, cityOther: null };
  }
  if (data.cityId === OTHER_CITY) {
    const parsed = cityNameSchema.safeParse(data.cityOther ?? "");
    if (!parsed.success) throw invalid("cityOther", parsed.error.issues[0].message);
    const [match] = await db
      .select({ id: cities.id, isActive: cities.isActive })
      .from(cities)
      .where(sql`lower(${cities.name}) = lower(${parsed.data})`);
    return match?.isActive ? { cityId: match.id, cityOther: null } : { cityId: null, cityOther: parsed.data };
  }
  return { cityId: null, cityOther: null };
}
