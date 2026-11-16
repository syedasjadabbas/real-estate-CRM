import { connection, type NextRequest } from "next/server";
import { logExport } from "@/modules/audit/export-log";
import { listTargets, targetsCsv } from "@/modules/targets/service";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { errorResponse, queryObject } from "@/server/http";

/** GET ?period&anchor — the observed "Export CSV" of the visible targets grid (same scope as the page). Audited. */
export async function GET(req: NextRequest) {
  await connection();
  try {
    const actor = await requireActor();
    const db = getDb();
    const grid = await listTargets(db, actor, queryObject(req), new Date(), { all: true });
    const filename = `targets-${grid.period}-${grid.periodStart}.csv`;
    const body = targetsCsv(grid);
    await logExport(db, actor, "targets.export", "report", null, { file: filename, agents: grid.rows.length, period: grid.period, start: grid.periodStart, end: grid.periodEnd, search: grid.q || null, team: grid.team || null });
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
