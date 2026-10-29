import { rebuildInstallments } from "@/modules/tasks/commands";
import { apiRoute } from "@/server/http";

/** POST — replaces the schedule rows with the ones generated from the saved figures. */
export const POST = apiRoute(async ({ db, actor, params }) => rebuildInstallments(db, actor, params.id));
