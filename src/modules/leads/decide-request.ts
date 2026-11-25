import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/server/db";
import { bookingPayments, bookings, clients, leadRequests, leads, lostReasons } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, forbidden, notFound } from "@/server/errors";
import { cancelBooking, confirmSale } from "@/modules/bookings/commands";
import { parse } from "@/modules/clients/support";
import { leadLink, notify } from "@/modules/notifications/service";
import { phoneProblem } from "./input-rules";
import { markLost, updateLead } from "./commands";
import { REQUEST_LABELS, type LeadRequestType } from "./requests";
import { audit, loadAccessibleLead, logActivity } from "./support";
import { canVerifyLeads } from "./verification";

const decision = z.object({
  approve: z.boolean(),
  comment: z.string().trim().max(1000, "Use at most 1,000 characters").optional().default(""),
  /** Wrong number, approved: the corrected number. Empty: the number is wrong and there is no other. */
  phoneCountryCode: z.string().trim().optional(),
  phoneNumber: z.string().trim().optional(),
});

/**
 * An Admin or Super Admin decides a lead request:
 * - name change: approved, the new name replaces the old one (on the client too, when it had the same name);
 * - wrong number: approved with a number, it is corrected and the agent carries on; approved without one, the
 *   lead is Lost (Invalid number); rejected, the number is right and the agent carries on;
 * - successfully booked: approved, the booking is Closed Won, which still needs the down payment in Finance;
 *   rejected, a booking made by the request is cancelled when no money was posted on it.
 */
export async function decideLeadRequest(db: Database, actor: Actor, requestId: string, input: unknown) {
  if (!canVerifyLeads(actor)) throw forbidden("Only an Admin or Super Admin decides this.");
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw notFound("Request");
  const { approve, comment, phoneCountryCode, phoneNumber } = parse(decision, input);
  if (!approve && !comment) throw new AppError("VALIDATION_FAILED", "Give a reason.", { fields: { comment: "Give a reason" } });
  return db.transaction(async (tx) => {
    const inTx = tx as unknown as Database;
    const [request] = await tx.select().from(leadRequests).where(eq(leadRequests.id, requestId)).for("update");
    if (!request) throw notFound("Request");
    if (request.status !== "pending") throw new AppError("BUSINESS_RULE", "This request has already been decided.");
    const type = request.type as LeadRequestType;
    const data = request.data;
    const { lead } = await loadAccessibleLead(tx, actor, request.leadId, type !== "booked"); // a booking locks itself, its unit, then its lead
    const now = new Date();
    let outcome = approve ? "approved" : "rejected";

    if (type === "name_change" && approve) {
      const name = String(data.to);
      const parts = { firstName: String(data.firstName ?? "") || null, lastName: String(data.lastName ?? "") || null };
      await tx.update(leads).set({ name, ...(parts.firstName ? parts : {}), updatedAt: now }).where(eq(leads.id, lead.id));
      if (lead.clientId) await tx.update(clients).set({ name, ...(parts.firstName ? parts : {}), updatedAt: now }).where(and(eq(clients.id, lead.clientId), eq(clients.name, lead.name)));
      await audit(tx, actor, "lead.update", lead.id, { name: lead.name }, { name });
    }
    if (type === "wrong_number") {
      await tx.update(leads).set({ wrongNumberAt: null, updatedAt: now }).where(eq(leads.id, lead.id));
      if (approve && phoneNumber) {
        const problem = phoneProblem(phoneCountryCode || lead.phoneCountryCode, phoneNumber);
        if (problem) throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { phoneNumber: problem } });
        const saved = await updateLead(inTx, actor, lead.id, { phoneCountryCode: phoneCountryCode || lead.phoneCountryCode, phoneNumber });
        if (!saved.changed.length) throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { phoneNumber: "That is the same number" } });
        outcome = "corrected";
      } else if (approve) {
        const [reason] = await tx.select({ id: lostReasons.id }).from(lostReasons).where(eq(lostReasons.name, "Invalid number"));
        if (!reason) throw new AppError("BUSINESS_RULE", "Add “Invalid number” to the lost reasons first.");
        if (lead.stage !== "lost_lead") await markLost(inTx, actor, lead.id, { lostReasonId: reason.id, note: comment || "Wrong number, checked" });
        outcome = "lost";
      }
    }
    if (type === "booked") {
      const bookingId = String(data.bookingId);
      if (approve) await confirmSale(tx, actor, bookingId, comment || "Reported as Successfully Booked and approved");
      else if (data.created) {
        const [b] = await tx.select({ stage: bookings.stage }).from(bookings).where(eq(bookings.id, bookingId));
        const [paid] = await tx.select({ id: bookingPayments.id }).from(bookingPayments).where(eq(bookingPayments.bookingId, bookingId)).limit(1);
        if (b && b.stage === "token_pending" && !paid) await cancelBooking(inTx, actor, bookingId, { reason: `Not booked: ${comment}` });
      }
    }

    await tx
      .update(leadRequests)
      .set({ status: approve ? "approved" : "rejected", decidedById: actor.id, decidedAt: now, comment: comment || null, data: { ...data, outcome } })
      .where(eq(leadRequests.id, requestId));
    await logActivity(tx, { leadId: lead.id, actorId: actor.id, type: "request", body: comment || null, data: { ...data, request: type, state: approve ? "approved" : "rejected", outcome } });
    await audit(tx, actor, approve ? "lead.request_approve" : "lead.request_reject", lead.id, { requestId, type }, { outcome, comment: comment || null });
    await notify(
      tx,
      [
        {
          userId: request.requestedById,
          type: "lead_request_decided",
          title: `${REQUEST_LABELS[type]} ${approve ? "approved" : "rejected"} · ${lead.name}`,
          body: outcome === "corrected" ? "The number was corrected. You can work on the lead again." : outcome === "lost" ? "The number is wrong, so the lead was marked Lost." : comment || `Decided by ${actor.name}.`,
          link: leadLink(lead.id),
          dedupeKey: `lead_request_decided:${requestId}`,
        },
      ],
      actor.id,
    );
    return { outcome };
  });
}
