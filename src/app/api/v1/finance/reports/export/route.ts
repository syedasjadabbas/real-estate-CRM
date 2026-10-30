import { connection, type NextRequest } from "next/server";
import { exportReport } from "@/modules/finance/reports";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { errorResponse, queryObject } from "@/server/http";

/** GET ?report=collections|outstanding_project|outstanding_agent&from&to — audited CSV (FR-205). */
export async function GET(req: NextRequest) {
  await connection();
  try {
    const actor = await requireActor();
    const { body, filename } = await exportReport(getDb(), actor, queryObject(req));
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
