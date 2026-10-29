import { createTask } from "@/modules/tasks/commands";
import { listTasks } from "@/modules/tasks/queries";
import { apiRoute, queryObject, readJson } from "@/server/http";

/** GET /api/v1/tasks?q&status&type&assignee=<id|me>&overdue=1&sort&dir&page — within the actor's task scope. */
export const GET = apiRoute(async ({ req, db, actor }) => listTasks(db, actor, queryObject(req)));

/** POST { title, type, dueAt?, assigneeId?, leadId?, bookingId?, description?, proposal?, rows? } */
export const POST = apiRoute(async ({ req, db, actor }) => createTask(db, actor, await readJson(req)), 201);
