import { leadTodos, TODO_BUCKETS, type TodoBucket } from "@/modules/leads/queries";
import { apiRoute, resolveProjectId } from "@/server/http";

/** GET ?bucket=today|doneToday|tomorrow|7d|15d|30d|overdue|unattended */
export const GET = apiRoute(async ({ req, db, actor }) => {
  const requested = req.nextUrl.searchParams.get("bucket") ?? "today";
  const bucket = (TODO_BUCKETS as readonly string[]).includes(requested) ? (requested as TodoBucket) : "today";
  return leadTodos(db, actor, await resolveProjectId(req, db), bucket);
});
