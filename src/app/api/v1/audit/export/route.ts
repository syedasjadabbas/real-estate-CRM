import { connection, type NextRequest } from "next/server";
import { auditLogCsv } from "@/modules/audit/service";
import { requireActor } from "@/server/auth/current-user";
import { csvResponse } from "@/server/csv";
import { getDb } from "@/server/db";
import { errorResponse, queryObject } from "@/server/http";

/** GET ?q&actor&entity&action&from&to — the audit log as CSV, same filters as the page (16 Nov 2026). */
export async function GET(req: NextRequest) {
  await connection();
  try {
    const actor = await requireActor();
    const { filename, body } = await auditLogCsv(getDb(), actor, queryObject(req));
    return csvResponse(filename, body);
  } catch (error) {
    return errorResponse(error);
  }
}
