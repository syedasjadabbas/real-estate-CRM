import { canManageAssignment, readAssignmentSettings, updateAssignmentSettings } from "@/modules/leads/assignment";
import { apiRoute, readJson } from "@/server/http";
import { forbidden } from "@/server/errors";

/** GET / PUT the automatic-assignment weights and thresholds. Super Admins and Admins. */
export const GET = apiRoute(async ({ db, actor }) => {
  if (!canManageAssignment(actor)) throw forbidden();
  return readAssignmentSettings(db);
});
export const PUT = apiRoute(async ({ req, db, actor }) => updateAssignmentSettings(db, actor, await readJson(req)));
