import { connection, type NextRequest } from "next/server";
import { logExport } from "@/modules/audit/export-log";
import { performanceCsv, performanceReport } from "@/modules/performance/service";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { errorResponse, queryObject } from "@/server/http";

/** GET ?from&to&team — the observed "Export CSV" of the agent table, same scope as the page. Audited. */
export async function GET(req: NextRequest) {
  await connection();
  try {
    const actor = await requireActor();
    const db = getDb();
    const report = await performanceReport(db, actor, queryObject(req));
    const filename = `performance-${report.range.from}-to-${report.range.to}.csv`;
    const body = performanceCsv(report);
    await logExport(db, actor, "performance.export", "report", null, { file: filename, agents: report.allRows.length, from: report.range.from, to: report.range.to, team: report.team });
    return new Response(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
