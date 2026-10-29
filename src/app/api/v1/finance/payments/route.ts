import { recordPayment } from "@/modules/finance/commands";
import { listPayments } from "@/modules/finance/queries";
import { apiRoute, queryObject, readJson } from "@/server/http";

/** GET ?type&from&to&bookingId&page — finance roles. */
export const GET = apiRoute(async ({ req, db, actor }) => listPayments(db, actor, queryObject(req)));

/** POST { bookingId, type, amount, receivedOn, methodId, reference?, note? }; an Idempotency-Key header makes retries safe. */
export const POST = apiRoute(async ({ req, db, actor }) => {
  const body = await readJson(req);
  const key = req.headers.get("idempotency-key");
  return recordPayment(db, actor, key ? { ...body, idempotencyKey: key } : body);
}, 201);
