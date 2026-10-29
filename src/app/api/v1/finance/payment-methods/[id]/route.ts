import { setPaymentMethodActive } from "@/modules/finance/commands";
import { AppError } from "@/server/errors";
import { apiRoute, readJson } from "@/server/http";

/** PATCH { active } — super admin; methods are deactivated, never deleted. */
export const PATCH = apiRoute(async ({ req, db, actor, params }) => {
  const { active } = await readJson(req);
  if (typeof active !== "boolean") throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { active: "Send true or false" } });
  return setPaymentMethodActive(db, actor, params.id, active);
});
