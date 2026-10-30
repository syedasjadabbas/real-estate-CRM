import { getEmployee, saveEmployeeProfile } from "@/modules/employees/service";
import { apiRoute, readJson } from "@/server/http";

export const GET = apiRoute(async ({ db, actor, params }) => getEmployee(db, actor, params.id));

/**
 * PATCH { designation?, department?, phoneCountryCode?, phoneNumber?, joiningDate? } — super admin,
 * admin, HR. Account fields (name, email, role, status) are rejected (pending Q2).
 */
export const PATCH = apiRoute(async ({ req, db, actor, params }) => saveEmployeeProfile(db, actor, params.id, await readJson(req)));
