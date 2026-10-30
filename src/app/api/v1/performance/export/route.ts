import { connection, type NextRequest } from "next/server";
import { performanceCsv, performanceReport } from "@/modules/performance/service";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { errorResponse, queryObject } from "@/server/http";

/** GET ?from&to&team — the observed "Export CSV" of the agent table, same scope as the page. */
export async function GET(req: NextRequest) {
  await connection();
  try {
    const actor = await requireActor();
    const report = await performanceReport(getDb(), actor, queryObject(req));
    return new Response(performanceCsv(report), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="performance-${report.range.from}-to-${report.range.to}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
