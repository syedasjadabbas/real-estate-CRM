import { resetAccountPassword } from "@/modules/accounts/service";
import { apiRoute, readJson } from "@/server/http";

/** POST { password } — sets a new password and ends the user's sessions. */
export const POST = apiRoute(async ({ req, db, actor, params }) => resetAccountPassword(db, actor, params.id, await readJson(req)));
