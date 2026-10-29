import { updateTask } from "@/modules/tasks/commands";
import { getTaskDetail } from "@/modules/tasks/queries";
import { apiRoute, readJson } from "@/server/http";

export const GET = apiRoute(async ({ db, actor, params }) => getTaskDetail(db, actor, params.id));

/** PATCH any task field; `proposal` without `rows` regenerates the schedule, with `rows` stores the edited rows. */
export const PATCH = apiRoute(async ({ req, db, actor, params }) => updateTask(db, actor, params.id, await readJson(req)));
