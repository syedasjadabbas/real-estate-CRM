import { leadTodos, TODO_BUCKETS, type TodoBucket } from "@/modules/leads/queries";
import { apiRoute, resolveProjectId } from "@/server/http";

/** GET ?bucket=today|doneToday|tomorrow|7d|15d|30d|overdue|unattended&page= — all the counts, and 50 items of the bucket per page. */
export const GET = apiRoute(async ({ req, db, actor }) => {
  const requested = req.nextUrl.searchParams.get("bucket") ?? "today";
  const bucket = (TODO_BUCKETS as readonly string[]).includes(requested) ? (requested as TodoBucket) : "today";
  return leadTodos(db, actor, await resolveProjectId(req, db), bucket, undefined, req.nextUrl.searchParams.get("page") ?? 1);
});
