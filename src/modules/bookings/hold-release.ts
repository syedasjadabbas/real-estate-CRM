import { and, asc, eq, inArray, isNotNull, lt, notExists, sql } from "drizzle-orm";
import type { Database } from "@/server/db";
import { auditLogs, bookingPayments, bookingStageHistory, bookings, units } from "@/server/db/schema";
import { transitionUnitStatus } from "@/modules/inventory/status";
import { HOLD_EXPIRED_REASON, HOLD_STAGES, type BookingStage } from "./constants";
import { businessToday } from "./today";

// Kept free of the wider app graph (sessions, clients, leads commands) so the scheduled job
// (scripts/jobs/release-holds.mjs) can load it directly.

/**
 * FR-081 release rule (client confirmation, 10 Nov 2026: "expires after 7 days, unit returns to
 * Available"). A booking's hold has expired and is released when all of these hold:
 * - it is still in a hold stage (Negotiation or Token pending: the token has not been received);
 * - it has a Reserved-until date and that date is before today in the business time zone;
 * - it has no recorded payment at all (any `booking_payments` row, even one later reversed).
 * Bookings without a Reserved-until date (created before the 7-day default) are never released.
 */
function expiredHoldCondition(today: string) {
  return and(
    inArray(bookings.stage, HOLD_STAGES),
    isNotNull(bookings.reservedUntil),
    lt(bookings.reservedUntil, today),
    notExists(sql`(select 1 from ${bookingPayments} where ${bookingPayments.bookingId} = ${bookings.id})`),
  );
}

export type HoldReleaseOutcome = {
  bookingId: string;
  unitNo: string;
  stage: BookingStage;
  reservedUntil: string;
  /** released: done · skipped: changed since it was listed (payment, stage move, new date) · failed: error, rolled back. */
  result: "eligible" | "released" | "skipped" | "failed";
  error?: string;
};

export type HoldReleaseResult = {
  job: "release-holds";
  dryRun: boolean;
  today: string;
  status: "dry_run" | "completed" | "completed_with_errors";
  eligible: number;
  released: number;
  skipped: number;
  failed: number;
  bookings: HoldReleaseOutcome[];
};

/** Bookings whose hold has expired and would be released now (read only). */
export async function findExpiredHolds(db: Database, today: string) {
  return db
    .select({ bookingId: bookings.id, unitNo: units.unitNo, stage: bookings.stage, reservedUntil: bookings.reservedUntil })
    .from(bookings)
    .innerJoin(units, eq(units.id, bookings.unitId))
    .where(expiredHoldCondition(today))
    .orderBy(asc(bookings.reservedUntil), asc(bookings.createdAt));
}

/**
 * Releases one expired hold in its own transaction. The booking row is locked first (the same
 * lock recordPayment takes), then the rule is re-checked under the lock: a payment, stage move or
 * new date that committed first wins and the booking is skipped. Lock order booking → unit, as in
 * cancelBooking. The lead is left where it is, as cancelBooking does (decision 29 Oct 2026).
 * There is no user actor: audit and history rows carry actor null and ip null (as the backup and
 * sign-in cleanup jobs record theirs).
 */
async function releaseOne(db: Database, bookingId: string, today: string): Promise<"released" | "skipped"> {
  return db.transaction(async (tx) => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), expiredHoldCondition(today)))
      .for("update");
    if (!booking) return "skipped";
    // The payment check above ran before the row lock was granted; re-read now that it is held so a
    // payment committed while we waited is seen (READ COMMITTED takes a fresh snapshot per statement).
    const [payment] = await tx.select({ id: bookingPayments.id }).from(bookingPayments).where(eq(bookingPayments.bookingId, bookingId)).limit(1);
    if (payment) return "skipped";

    const [row] = await tx
      .update(bookings)
      .set({ stage: "cancelled", stageChangedAt: sql`now()`, updatedAt: sql`now()`, cancelledAt: new Date(), cancelledReason: HOLD_EXPIRED_REASON })
      .where(and(eq(bookings.id, bookingId), eq(bookings.stage, booking.stage)))
      .returning({ id: bookings.id });
    if (!row) return "skipped";
    await transitionUnitStatus(tx, {
      unitId: booking.unitId,
      from: ["reserved"],
      to: "available",
      actorId: null,
      ip: null,
      source: "booking",
      reason: `Booking cancelled: ${HOLD_EXPIRED_REASON}`,
    });
    await tx.insert(bookingStageHistory).values({ bookingId, fromStage: booking.stage, toStage: "cancelled", actorId: null, note: HOLD_EXPIRED_REASON });
    await tx.insert(auditLogs).values({
      actorId: null,
      ip: null,
      action: "booking.cancel",
      entity: "booking",
      entityId: bookingId,
      before: { stage: booking.stage, reservedUntil: booking.reservedUntil },
      after: { stage: "cancelled", reason: HOLD_EXPIRED_REASON, source: "hold_expiry", today },
    });
    return "released";
  });
}

/**
 * FR-081 job body: releases every expired, unpaid hold (one transaction per booking, so one failure
 * never undoes the others). `dryRun` only lists them. Safe to repeat and to overlap: a booking
 * already released no longer matches the rule.
 */
export async function releaseExpiredHolds(db: Database, { dryRun = false, today = businessToday() }: { dryRun?: boolean; today?: string } = {}): Promise<HoldReleaseResult> {
  const candidates = await findExpiredHolds(db, today);
  const outcomes: HoldReleaseOutcome[] = [];
  for (const c of candidates) {
    const base = { bookingId: c.bookingId, unitNo: c.unitNo, stage: c.stage, reservedUntil: c.reservedUntil! };
    if (dryRun) {
      outcomes.push({ ...base, result: "eligible" });
      continue;
    }
    try {
      outcomes.push({ ...base, result: await releaseOne(db, c.bookingId, today) });
    } catch (error) {
      outcomes.push({ ...base, result: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }
  const tally = (r: HoldReleaseOutcome["result"]) => outcomes.filter((o) => o.result === r).length;
  const failed = tally("failed");
  return {
    job: "release-holds",
    dryRun,
    today,
    status: dryRun ? "dry_run" : failed > 0 ? "completed_with_errors" : "completed",
    eligible: candidates.length,
    released: tally("released"),
    skipped: tally("skipped"),
    failed,
    bookings: outcomes,
  };
}
