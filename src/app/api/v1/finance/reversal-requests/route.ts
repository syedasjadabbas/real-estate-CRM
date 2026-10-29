import { reversalRequestsForActor } from "@/modules/finance/queries";
import { apiRoute } from "@/server/http";

/** GET ?status=pending|approved|rejected — requests the actor may see or decide. */
export const GET = apiRoute(async ({ req, db, actor }) => {
  const status = req.nextUrl.searchParams.get("status");
  return reversalRequestsForActor(db, actor, status === "approved" || status === "rejected" ? status : "pending");
});
