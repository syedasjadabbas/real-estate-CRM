import { listEmployees } from "@/modules/employees/service";
import { apiRoute, queryObject } from "@/server/http";

/** GET ?q&role&status&department&sort&dir&page — super admin, admin, HR; managers read-only. */
export const GET = apiRoute(async ({ req, db, actor }) => listEmployees(db, actor, queryObject(req)));
