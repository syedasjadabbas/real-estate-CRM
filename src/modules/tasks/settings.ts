import { eq } from "drizzle-orm";
import type { Database } from "@/server/db";
import { appSettings, auditLogs } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import type { DbOrTx } from "@/modules/leads/support";
import { FLOOR_PRICE_DEFAULTS, isFloorPriceKey, PROPOSAL_FALLBACKS, PROPOSAL_SETTING_KEYS, type FloorPriceKey, type ProposalSettingKey } from "./constants";
import type { ProposalSettings } from "./plan";
import { assertCanTask } from "./policy";
import { parseTask } from "./support";
import { proposalSettingsSchema } from "./validation";

const num = (v: string | undefined) => (v === undefined || v.trim() === "" ? null : Number(v));

/** A floor rate (Q44): the client's default while no row exists; a blank row means an admin cleared it. */
const floorPrice = (map: Map<string, string>, key: FloorPriceKey) => {
  const raw = map.get(PROPOSAL_SETTING_KEYS[key]);
  return raw === undefined ? FLOOR_PRICE_DEFAULTS[key] : num(raw);
};

/** FR-009 proposal settings. Unset optional settings are null (no value is assumed). */
export async function getProposalSettings(db: DbOrTx): Promise<ProposalSettings> {
  const rows = await db.select().from(appSettings);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const get = (k: ProposalSettingKey) => num(map.get(PROPOSAL_SETTING_KEYS[k]));
  return {
    agentCap: get("agentCap") ?? PROPOSAL_FALLBACKS.agentCap,
    managerCap: get("managerCap"),
    downPaymentPct: get("downPaymentPct") ?? PROPOSAL_FALLBACKS.downPaymentPct,
    installmentCount: get("installmentCount") ?? PROPOSAL_FALLBACKS.installmentCount,
    defaultPricePerSqft: get("defaultPricePerSqft"),
    roiPerSqft: get("roiPerSqft"),
    floorPriceGF: floorPrice(map, "floorPriceGF"),
    floorPriceFF: floorPrice(map, "floorPriceFF"),
    floorPriceSF: floorPrice(map, "floorPriceSF"),
  };
}

/**
 * Admins only. Changes apply to proposals saved afterwards; proposals already saved show a "price
 * changed" note until they are saved again or reconciled (Q47).
 */
export async function updateProposalSettings(db: Database, actor: Actor, input: unknown) {
  assertCanTask(actor, "settings");
  const data = parseTask(proposalSettingsSchema, input);
  return db.transaction(async (tx) => {
    const changed: string[] = [];
    for (const [name, value] of Object.entries(data) as [ProposalSettingKey, number | null | undefined][]) {
      if (value === undefined) continue;
      const key = PROPOSAL_SETTING_KEYS[name];
      const floor = isFloorPriceKey(name);
      const [current] = await tx.select().from(appSettings).where(eq(appSettings.key, key));
      // A floor rate without a row is in effect at its default, so that is the "before" value.
      const before = current?.value ?? (floor ? String(FLOOR_PRICE_DEFAULTS[name]) : "");
      const after = value === null ? "" : String(value);
      if (before === after) continue;
      if (value === null && !floor) {
        await tx.delete(appSettings).where(eq(appSettings.key, key));
      } else {
        // Clearing a floor rate keeps a blank row, otherwise the default would come back.
        await tx
          .insert(appSettings)
          .values({ key, value: after, updatedById: actor.id })
          .onConflictDoUpdate({ target: appSettings.key, set: { value: after, updatedById: actor.id, updatedAt: new Date() } });
      }
      await tx.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: "app.setting", entity: "app_setting", entityId: key, before: { value: before }, after: { value: after } });
      changed.push(name);
    }
    return { changed };
  });
}
