import { and, asc, eq, isNull, notInArray } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/server/db";
import { bookings, leadRequests, units } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { parse } from "@/modules/clients/support";
import { createRequest } from "@/modules/leads/requests";
import { loadAccessibleLead } from "@/modules/leads/support";
import { assertWorkable } from "@/modules/leads/verification";
import { createBooking } from "./commands";
import { assertCanBooking, canAccessBooking } from "./policy";
import { uploadBookingProof } from "./proofs";

/**
 * Successfully Booked (client, 25 Nov 2026): the agent picks it with screenshots, and an Admin approves it. The
 * sale needs a unit, so a lead with no open booking gets one now (the unit is held at once); approving closes it
 * as Won, which still needs the down payment posted in Finance.
 */
const openBooking = (leadId: string) => and(eq(bookings.leadId, leadId), notInArray(bookings.stage, ["confirmed", "cancelled"]));

export async function bookedFormOptions(db: Database, actor: Actor, leadId: string) {
  const { lead, members } = await loadAccessibleLead(db, actor, leadId);
  const [open, waiting] = await Promise.all([
    db.select({ id: bookings.id, agentId: bookings.agentId, unitNo: units.unitNo }).from(bookings).innerJoin(units, eq(units.id, bookings.unitId)).where(openBooking(leadId)),
    db.select({ id: leadRequests.id }).from(leadRequests).where(and(eq(leadRequests.leadId, leadId), eq(leadRequests.type, "booked"), eq(leadRequests.status, "pending"))),
  ]);
  const mine = open.filter((b) => canAccessBooking(actor, b.agentId, members));
  const available = mine.length
    ? []
    : await db
        .select({ id: units.id, unitNo: units.unitNo, areaSqft: units.areaSqft, floor: units.floor, block: units.block })
        .from(units)
        .where(and(eq(units.projectId, lead.projectId), eq(units.status, "available"), isNull(units.archivedAt)))
        .orderBy(asc(units.unitNo));
  return { waiting: waiting.length > 0, bookings: mine.map((b) => ({ id: b.id, unitNo: b.unitNo })), units: available };
}

const schema = z.object({
  bookingId: z.uuid().optional(),
  unitId: z.uuid("Choose the unit").optional(),
  tokenAmount: z.string().trim().optional(),
  note: z.string().trim().max(1000, "Use at most 1,000 characters").optional().transform((v) => v || null),
});

export async function requestBooked(db: Database, actor: Actor, leadId: string, input: unknown, files: { bytes: Uint8Array; name: string }[]) {
  assertCanBooking(actor, "create");
  const data = parse(schema, input);
  const invalid = (field: string, message: string) => new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { [field]: message } });
  if (files.length === 0) throw invalid("files", "Add at least one screenshot");
  if (files.length > 5) throw invalid("files", "At most 5 screenshots");
  const options = await bookedFormOptions(db, actor, leadId);
  if (options.waiting) throw new AppError("CONFLICT", "This sale is already waiting for an Admin.");
  const { lead } = await loadAccessibleLead(db, actor, leadId);
  assertWorkable(actor, lead);
  let bookingId = options.bookings.find((b) => b.id === data.bookingId)?.id ?? (options.bookings.length === 1 ? options.bookings[0].id : undefined);
  let created = false;
  if (!bookingId) {
    if (options.bookings.length > 1) throw invalid("bookingId", "Choose the booking");
    if (!data.unitId) throw invalid("unitId", "Choose the unit");
    if (!data.tokenAmount) throw invalid("tokenAmount", "Enter the amount received");
    ({ bookingId } = await createBooking(db, actor, { projectId: lead.projectId, leadId, unitId: data.unitId, tokenAmount: data.tokenAmount }));
    created = true;
  }
  for (const f of files) await uploadBookingProof(db, actor, bookingId, f);
  const [unit] = await db.select({ unitNo: units.unitNo, amount: bookings.tokenAmount }).from(bookings).innerJoin(units, eq(units.id, bookings.unitId)).where(eq(bookings.id, bookingId));
  const id = await db.transaction((tx) => createRequest(tx, actor, lead, "booked", { bookingId, created, unitNo: unit.unitNo, amount: unit.amount, files: files.length }, data.note));
  return { requestId: id, bookingId };
}
