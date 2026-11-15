import { connection, type NextRequest } from "next/server";
import { employeeProfileCsv } from "@/modules/people/export";
import { requireActor } from "@/server/auth/current-user";
import { csvResponse } from "@/server/csv";
import { getDb } from "@/server/db";
import { errorResponse, queryObject } from "@/server/http";

/** GET ?from&to — one employee's work record as CSV (Admins and Super Admins; audited). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const actor = await requireActor();
    const { id } = await params;
    const file = await employeeProfileCsv(getDb(), actor, id, queryObject(req) as Record<string, string>);
    return csvResponse(file.filename, file.body);
  } catch (error) {
    return errorResponse(error);
  }
}
