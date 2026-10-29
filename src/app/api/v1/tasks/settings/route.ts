import { forbidden } from "@/server/errors";
import { canDoTask } from "@/modules/tasks/policy";
import { getProposalSettings, updateProposalSettings } from "@/modules/tasks/settings";
import { apiRoute, readJson } from "@/server/http";

/** GET proposal settings (FR-009) — anyone who works tasks. */
export const GET = apiRoute(async ({ db, actor }) => {
  if (!canDoTask(actor, "view")) throw forbidden();
  return getProposalSettings(db);
});

/** PATCH { agentCap?, managerCap?, downPaymentPct?, installmentCount?, defaultPricePerSqft?, roiPerSqft? } — admins; blank clears optional ones. */
export const PATCH = apiRoute(async ({ req, db, actor }) => updateProposalSettings(db, actor, await readJson(req)));
