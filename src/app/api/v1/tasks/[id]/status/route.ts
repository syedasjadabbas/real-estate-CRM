import { setTaskStatus } from "@/modules/tasks/commands";
import { apiRoute, readJson } from "@/server/http";

/** POST { status } — open | in_progress | done | cancelled. */
export const POST = apiRoute(async ({ req, db, actor, params }) => setTaskStatus(db, actor, params.id, await readJson(req)));
