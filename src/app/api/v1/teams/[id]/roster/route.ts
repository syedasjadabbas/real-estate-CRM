import { saveRoster } from "@/modules/teams/commands";
import { getRosterDay, getRosterMonth } from "@/modules/teams/queries";
import { AppError } from "@/server/errors";
import { apiRoute, readJson } from "@/server/http";

/** GET ?date=YYYY-MM-DD (day view) or ?month=YYYY-MM (month view). */
export const GET = apiRoute(async ({ req, db, actor, params }) => {
  const month = req.nextUrl.searchParams.get("month");
  const date = req.nextUrl.searchParams.get("date");
  if (month) return getRosterMonth(db, actor, params.id, month);
  if (date) return getRosterDay(db, actor, params.id, date);
  throw new AppError("VALIDATION_FAILED", "Pass ?date or ?month.");
});

/** PUT ?date=YYYY-MM-DD { entries: [{ userId, status | null }] } — locked after 11:00 and for past days. */
export const PUT = apiRoute(async ({ req, db, actor, params }) => saveRoster(db, actor, params.id, req.nextUrl.searchParams.get("date") ?? "", await readJson(req)));
