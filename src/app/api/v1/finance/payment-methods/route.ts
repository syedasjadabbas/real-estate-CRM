import { addPaymentMethod } from "@/modules/finance/commands";
import { canDoFinance } from "@/modules/finance/policy";
import { listPaymentMethods } from "@/modules/finance/queries";
import { forbidden } from "@/server/errors";
import { apiRoute, readJson } from "@/server/http";

export const GET = apiRoute(async ({ db, actor }) => {
  if (!canDoFinance(actor, "viewAll") && !canDoFinance(actor, "record")) throw forbidden();
  return listPaymentMethods(db);
});

/** POST { name } — super admin. */
export const POST = apiRoute(async ({ req, db, actor }) => addPaymentMethod(db, actor, await readJson(req)), 201);
