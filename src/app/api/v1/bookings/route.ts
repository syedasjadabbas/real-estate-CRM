import { createBooking } from "@/modules/bookings/commands";
import { listBookings } from "@/modules/bookings/queries";
import { businessToday } from "@/modules/bookings/today";
import { apiRoute, queryObject, readJson } from "@/server/http";
import { getProjectScope } from "@/server/project-scope";

/** GET /api/v1/bookings?project=<id|all>&stage&q&page — defaults to the selected project. */
export const GET = apiRoute(async ({ req, db, actor }) =>
  listBookings(db, actor, queryObject(req), (await getProjectScope()).activeProjectId, businessToday()),
);

/** POST { projectId, leadId, unitId, ratePerSqft, tokenAmount, reservedUntil?, paymentInstructions? } — reserves the unit; 409 if taken. */
export const POST = apiRoute(async ({ req, db, actor }) => createBooking(db, actor, await readJson(req)), 201);
