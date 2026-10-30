import { performanceReport } from "@/modules/performance/service";
import { apiRoute, queryObject } from "@/server/http";

/** GET ?from&to&team&sort&dir&page — agent KPIs for the actor's scope (admins all, managers their teams, agents own). */
export const GET = apiRoute(async ({ req, db, actor }) => {
  const report = await performanceReport(db, actor, queryObject(req));
  // The paginated `rows` are the API payload; the full list is only used for CSV export.
  return Object.fromEntries(Object.entries(report).filter(([key]) => key !== "allRows"));
});
