import { updateFinanceSettings } from "@/modules/finance/commands";
import { canDoFinance } from "@/modules/finance/policy";
import { getFinanceSettings } from "@/modules/finance/queries";
import { forbidden } from "@/server/errors";
import { apiRoute, readJson } from "@/server/http";

export const GET = apiRoute(async ({ db, actor }) => {
  if (!canDoFinance(actor, "viewAll")) throw forbidden();
  return getFinanceSettings(db);
});

/** PUT { receipt_prefix?, reversal_prefix? } — super admin. */
export const PUT = apiRoute(async ({ req, db, actor }) => updateFinanceSettings(db, actor, await readJson(req)));
