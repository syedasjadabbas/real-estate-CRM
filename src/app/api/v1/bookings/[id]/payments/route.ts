import { bookingPaymentHistory } from "@/modules/finance/queries";
import { forbidden } from "@/server/errors";
import { apiRoute } from "@/server/http";

/** GET itemised payments of a booking (finance roles; managers for their team). */
export const GET = apiRoute(async ({ db, actor, params }) => {
  const rows = await bookingPaymentHistory(db, actor, params.id);
  if (rows === null) throw forbidden();
  return rows;
});
