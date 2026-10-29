import { eq } from "drizzle-orm";
import type { Database } from "@/server/db";
import { appSettings, auditLogs } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import type { DbOrTx } from "@/modules/leads/support";
import { PROPOSAL_FALLBACKS, PROPOSAL_SETTING_KEYS, type ProposalSettingKey } from "./constants";
import type { ProposalSettings } from "./plan";
import { assertCanTask } from "./policy";
import { parseTask } from "./support";
import { proposalSettingsSchema } from "./validation";

const num = (v: string | undefined) => (v === undefined || v.trim() === "" ? null : Number(v));

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
  };
}

/** Admins only. Changes apply to proposals saved afterwards; existing proposals keep their snapshot. */
export async function updateProposalSettings(db: Database, actor: Actor, input: unknown) {
  assertCanTask(actor, "settings");
  const data = parseTask(proposalSettingsSchema, input);
  return db.transaction(async (tx) => {
    const changed: string[] = [];
    for (const [name, value] of Object.entries(data) as [ProposalSettingKey, number | null | undefined][]) {
      if (value === undefined) continue;
      const key = PROPOSAL_SETTING_KEYS[name];
      const [current] = await tx.select().from(appSettings).where(eq(appSettings.key, key));
      const before = current?.value ?? "";
      const after = value === null ? "" : String(value);
      if (before === after) continue;
      if (value === null) {
        await tx.delete(appSettings).where(eq(appSettings.key, key));
      } else {
        await tx
          .insert(appSettings)
          .values({ key, value: after, updatedById: actor.id })
          .onConflictDoUpdate({ target: appSettings.key, set: { value: after, updatedById: actor.id, updatedAt: new Date() } });
      }
      await tx.insert(auditLogs).values({ actorId: actor.id, action: "app.setting", entity: "app_setting", entityId: key, before: { value: before }, after: { value: after } });
      changed.push(name);
    }
    return { changed };
  });
}
