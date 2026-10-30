import { collectionsByProject, outstandingBy } from "@/modules/finance/reports";
import { apiRoute, queryObject } from "@/server/http";

/** GET ?from&to — FR-205 collections by project and outstanding by project / agent (finance roles). */
export const GET = apiRoute(async ({ req, db, actor }) => {
  const q = queryObject(req);
  const [collections, byProject, byAgent] = await Promise.all([collectionsByProject(db, actor, q), outstandingBy(db, actor, "project"), outstandingBy(db, actor, "agent")]);
  return { collections, outstandingByProject: byProject, outstandingByAgent: byAgent };
});
