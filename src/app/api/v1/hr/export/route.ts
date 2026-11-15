import { connection, type NextRequest } from "next/server";
import { hrExport } from "@/modules/hr/exports";
import { requireActor } from "@/server/auth/current-user";
import { csvResponse } from "@/server/csv";
import { getDb } from "@/server/db";
import { errorResponse, queryObject } from "@/server/http";

/** GET ?kind=employees|leave|leave-balances|attendance-month|attendance-day plus the page's filters — HR CSV downloads. */
export async function GET(req: NextRequest) {
  await connection();
  try {
    const actor = await requireActor();
    const { kind, ...filters } = queryObject(req) as Record<string, string>;
    const file = await hrExport(getDb(), actor, kind, filters);
    return csvResponse(file.filename, file.body);
  } catch (error) {
    return errorResponse(error);
  }
}
