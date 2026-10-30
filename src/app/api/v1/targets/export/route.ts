import { connection, type NextRequest } from "next/server";
import { listTargets, targetsCsv } from "@/modules/targets/service";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { errorResponse, queryObject } from "@/server/http";

/** GET ?period&anchor — the observed "Export CSV" of the visible targets grid (same scope as the page). */
export async function GET(req: NextRequest) {
  await connection();
  try {
    const actor = await requireActor();
    const grid = await listTargets(getDb(), actor, queryObject(req));
    return new Response(targetsCsv(grid), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="targets-${grid.period}-${grid.periodStart}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
