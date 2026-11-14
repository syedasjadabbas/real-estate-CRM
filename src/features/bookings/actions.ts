"use server";

import { refresh } from "next/cache";
import { rejectBookingPayment } from "@/modules/bookings/commands";
import { advanceBooking, cancelBooking, createBooking, decideDiscount, updateBookingDetails } from "@/modules/bookings/commands";
import { requireActor } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { toActionError, type ActionResult } from "@/server/errors";

/**
 * Server actions for the Bookings UI. Each one re-reads the session (never trusts the client),
 * delegates to the service layer (which enforces permissions) and refreshes the router.
 */
async function run<T>(fn: (db: ReturnType<typeof getDb>, actor: Awaited<ReturnType<typeof requireActor>>) => Promise<T>) {
  try {
    const actor = await requireActor();
    const data = await fn(getDb(), actor);
    refresh();
    return { ok: true, data } as ActionResult<T>;
  } catch (error) {
    return toActionError(error) as ActionResult<T>;
  }
}

export async function createBookingAction(input: Record<string, unknown>): Promise<ActionResult<{ bookingId: string }>> {
  return run((db, actor) => createBooking(db, actor, input));
}

export async function advanceBookingAction(bookingId: string, toStage: string, note: string, proofFileId?: string | null, amount?: string | null) {
  return run((db, actor) => advanceBooking(db, actor, bookingId, { toStage, note, proofFileId, amount: amount || null }));
}

/** Accounts: the token payment is not genuine, so the booking is rejected (14 Nov 2026). */
export async function rejectBookingPaymentAction(bookingId: string, reason: string) {
  return run((db, actor) => rejectBookingPayment(db, actor, bookingId, { reason }));
}

export async function cancelBookingAction(bookingId: string, reason: string) {
  return run((db, actor) => cancelBooking(db, actor, bookingId, { reason }));
}

export async function updateBookingAction(bookingId: string, input: Record<string, unknown>) {
  return run((db, actor) => updateBookingDetails(db, actor, bookingId, input));
}

/** Admin or Super Admin: approve or reject (with a reason) a booking discount above the agent's cap. */
export async function decideDiscountAction(bookingId: string, approve: boolean, note: string) {
  return run((db, actor) => decideDiscount(db, actor, bookingId, { approve, note }));
}
