import { myRoster } from "@/modules/teams/queries";
import { businessToday } from "@/modules/bookings/today";
import { apiRoute } from "@/server/http";

/** GET ?month=YYYY-MM — an agent's own roster entries. */
export const GET = apiRoute(async ({ req, db, actor }) => myRoster(db, actor, req.nextUrl.searchParams.get("month") ?? businessToday().slice(0, 7)));
