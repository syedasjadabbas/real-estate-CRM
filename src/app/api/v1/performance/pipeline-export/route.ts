import { connection, type NextRequest } from "next/server";
import { pipelineCsv } from "@/modules/performance/pipeline-export";
import { requireActor } from "@/server/auth/current-user";
import { csvResponse } from "@/server/csv";
import { getDb } from "@/server/db";
import { notFound } from "@/server/errors";
import { errorResponse, queryObject } from "@/server/http";
import { getProjectScope } from "@/server/project-scope";

/** GET ?team&q — "Pipeline by agent" as CSV, for the project selected in the header (16 Nov 2026). */
export async function GET(req: NextRequest) {
  await connection();
  try {
    const actor = await requireActor();
    const scope = await getProjectScope();
    const project = scope.projects.find((p) => p.id === scope.activeProjectId);
    if (!project) throw notFound("Project");
    const { filename, body } = await pipelineCsv(getDb(), actor, queryObject(req), project);
    return csvResponse(filename, body);
  } catch (error) {
    return errorResponse(error);
  }
}
