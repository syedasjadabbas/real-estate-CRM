import { createLead } from "@/modules/leads/commands";
import { leadInputErrors } from "@/modules/leads/input-rules";
import { AppError } from "@/server/errors";
import { listLeads } from "@/modules/leads/queries";
import { apiRoute, queryObject, readJson, resolveProjectId } from "@/server/http";

/** GET /api/v1/leads — filters, search, sort and pagination as documented in API_DESIGN.md. */
export const GET = apiRoute(async ({ req, db, actor }) => listLeads(db, actor, await resolveProjectId(req, db), queryObject(req)));

/** POST /api/v1/leads — create (duplicate check + automatic assignment). */
export const POST = apiRoute(async ({ req, db, actor }) => {
  const input = await readJson(req);
  const fields = leadInputErrors((input ?? {}) as Record<string, unknown>);
  if (Object.keys(fields).length) throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields });
  return createLead(db, actor, input);
}, 201);
