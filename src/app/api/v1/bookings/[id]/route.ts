import { updateBookingDetails } from "@/modules/bookings/commands";
import { getBookingDetail } from "@/modules/bookings/queries";
import { businessToday } from "@/modules/bookings/today";
import { apiRoute, readJson } from "@/server/http";

export const GET = apiRoute(async ({ db, actor, params }) => getBookingDetail(db, actor, params.id, businessToday()));

/** PATCH { reservedUntil?, paymentInstructions?, agreementSentOn?, paymentDocsStatus? } — managers / admins. */
export const PATCH = apiRoute(async ({ req, db, actor, params }) => updateBookingDetails(db, actor, params.id, await readJson(req)));
