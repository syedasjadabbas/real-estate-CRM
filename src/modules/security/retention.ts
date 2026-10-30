import { z } from "zod";

/**
 * Sign-in log retention settings (docs/PRODUCTION_READINESS_PLAN.md §3). The cleanup job
 * `scripts/jobs/prune-signin-logs.mjs` repeats these keys and limits; a unit test keeps them equal.
 */
export const RETENTION_MONTHS_KEY = "security.signin_log_retention_months";
export const CLEANUP_ENABLED_KEY = "security.signin_log_cleanup_enabled";
export const LAST_RUN_KEY = "security.signin_log_cleanup_last_run";
/** Proposed default (C2), pending client confirmation. */
export const DEFAULT_RETENTION_MONTHS = 12;
export const MIN_RETENTION_MONTHS = 3;
export const MAX_RETENTION_MONTHS = 120;

export const retentionSettingsSchema = z
  .object({
    retentionMonths: z.coerce
      .number("Enter a number of months")
      .int("Use whole months")
      .min(MIN_RETENTION_MONTHS, `Keep at least ${MIN_RETENTION_MONTHS} months`)
      .max(MAX_RETENTION_MONTHS, `Keep at most ${MAX_RETENTION_MONTHS} months`),
    cleanupEnabled: z.boolean(),
    /** Must be true to switch automatic deletion on; deletion is permanent. */
    confirmEnable: z.boolean(),
  })
  .partial()
  .strict();
export type RetentionSettingsInput = z.input<typeof retentionSettingsSchema>;

export type LastCleanupRun = { at: string; status: string; eligible: number; deleted: number; retentionMonths: number; cutoff: string };

export function parseLastRun(value: string | undefined): LastCleanupRun | null {
  if (!value) return null;
  try {
    const v = JSON.parse(value) as Partial<LastCleanupRun>;
    return typeof v.at === "string" && typeof v.status === "string" ? (v as LastCleanupRun) : null;
  } catch {
    return null;
  }
}
