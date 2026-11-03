import { setAccountStatus } from "@/modules/accounts/service";
import { apiRoute, readJson } from "@/server/http";

/** POST { status: "active" | "inactive" } — manual deactivation / reactivation (Q3). */
export const POST = apiRoute(async ({ req, db, actor, params }) => setAccountStatus(db, actor, params.id, await readJson(req)));
