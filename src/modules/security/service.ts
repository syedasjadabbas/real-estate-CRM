import { inArray, sql } from "drizzle-orm";
import type { Database } from "@/server/db";
import { appSettings, auditLogs, signinLogs } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import type { DbOrTx } from "@/modules/leads/support";
import { parseTask } from "@/modules/tasks/support";
import { assertCanManageSecurity } from "./policy";
import {
  CLEANUP_ENABLED_KEY,
  DEFAULT_RETENTION_MONTHS,
  LAST_RUN_KEY,
  MAX_RETENTION_MONTHS,
  MIN_RETENTION_MONTHS,
  parseLastRun,
  RETENTION_MONTHS_KEY,
  retentionSettingsSchema,
} from "./retention";

/** Current retention settings. Absent keys mean the proposed defaults: 12 months, deletion off. */
export async function getRetentionSettings(db: DbOrTx) {
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, [RETENTION_MONTHS_KEY, CLEANUP_ENABLED_KEY, LAST_RUN_KEY]));
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const stored = map.get(RETENTION_MONTHS_KEY);
  const n = stored === undefined ? DEFAULT_RETENTION_MONTHS : Number(stored);
  const valid = Number.isInteger(n) && n >= MIN_RETENTION_MONTHS && n <= MAX_RETENTION_MONTHS;
  return {
    retentionMonths: valid ? n : DEFAULT_RETENTION_MONTHS,
    isDefault: stored === undefined,
    storedRetention: stored ?? null,
    storedValueInvalid: !valid,
    cleanupEnabled: map.get(CLEANUP_ENABLED_KEY) === "true",
    lastRun: parseLastRun(map.get(LAST_RUN_KEY)),
  };
}
export type RetentionSettings = Awaited<ReturnType<typeof getRetentionSettings>>;

/** Settings plus the current cutoff and how many sign-in logs are past it (admins only). */
export async function getRetentionStatus(db: Database, actor: Actor) {
  assertCanManageSecurity(actor);
  const settings = await getRetentionSettings(db);
  const [row] = await db
    .select({
      cutoff: sql<Date>`now() - make_interval(months => ${settings.retentionMonths}::int)`,
      eligible: sql<number>`count(*) filter (where ${signinLogs.at} < now() - make_interval(months => ${settings.retentionMonths}::int))::int`,
      total: sql<number>`count(*)::int`,
      oldest: sql<Date | null>`min(${signinLogs.at})`,
    })
    .from(signinLogs);
  return { ...settings, cutoff: new Date(row.cutoff), eligible: row.eligible, total: row.total, oldest: row.oldest ? new Date(row.oldest) : null };
}

/**
 * Super admin / admin. Changes the retention period and the automatic-deletion switch.
 * Switching deletion on needs `confirmEnable: true`. Every change is audited (`app.setting`).
 * Nothing is deleted here; the scheduled job does that.
 */
export async function updateRetentionSettings(db: Database, actor: Actor, input: unknown) {
  assertCanManageSecurity(actor);
  const data = parseTask(retentionSettingsSchema, input);
  return db.transaction(async (tx) => {
    const current = await getRetentionSettings(tx);
    if (data.cleanupEnabled === true && !current.cleanupEnabled && data.confirmEnable !== true) {
      throw new AppError("VALIDATION_FAILED", "Confirm that old sign-in logs may be permanently deleted.", { fields: { cleanupEnabled: "Confirmation required" } });
    }
    const updates: [string, string, string][] = [];
    if (data.retentionMonths !== undefined) {
      updates.push([RETENTION_MONTHS_KEY, current.storedRetention ?? "", String(data.retentionMonths)]);
    }
    if (data.cleanupEnabled !== undefined && data.cleanupEnabled !== current.cleanupEnabled) {
      updates.push([CLEANUP_ENABLED_KEY, String(current.cleanupEnabled), String(data.cleanupEnabled)]);
    }
    const changed: string[] = [];
    for (const [key, before, after] of updates) {
      if (before === after) continue;
      await tx
        .insert(appSettings)
        .values({ key, value: after, updatedById: actor.id })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: after, updatedById: actor.id, updatedAt: new Date() } });
      await tx.insert(auditLogs).values({ actorId: actor.id, action: "app.setting", entity: "app_setting", entityId: key, before: { value: before }, after: { value: after } });
      changed.push(key === RETENTION_MONTHS_KEY ? "retentionMonths" : "cleanupEnabled");
    }
    return { changed };
  });
}

/** For footnotes on pages that read sign-in logs (no permission needed: it is policy text). */
export async function signinRetentionNote(db: DbOrTx) {
  const s = await getRetentionSettings(db);
  return s.cleanupEnabled
    ? `Sign-in history older than ${s.retentionMonths} months is deleted automatically.`
    : `Sign-in history is currently kept indefinitely; a ${s.retentionMonths}-month retention period is proposed and automatic deletion is off.`;
}

