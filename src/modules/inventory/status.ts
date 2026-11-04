import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/modules/leads/support";
import { auditLogs, units } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { UNIT_STATUS_LABELS, type UnitStatus } from "./constants";

export type StatusSource = "manual" | "booking";

/**
 * Guarded status change: a single compare-and-set UPDATE that only succeeds while the unit is
 * still in one of `from`. Concurrent callers serialise on the row lock; the loser sees 0 rows
 * and gets CONFLICT, so two bookings can never both move the same Available unit to Reserved.
 * Bookings (FR-071) must change unit status only through this function.
 */
export async function transitionUnitStatus(
  db: DbOrTx,
  params: {
    unitId: string;
    from: readonly UnitStatus[];
    to: UnitStatus;
    actorId: string | null;
    /** Verified client IP for the audit row (Actor.ip). */
    ip?: string | null;
    source: StatusSource;
    reason?: string | null;
    /** Restrict to whole units (share-level booking waits for Q-B1). */
    wholeOnly?: boolean;
  },
) {
  const [row] = await db
    .update(units)
    .set({ status: params.to, statusChangedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(units.id, params.unitId),
        inArray(units.status, [...params.from]),
        params.wholeOnly ? eq(units.saleModel, "whole") : undefined,
      ),
    )
    .returning({ id: units.id });
  if (!row) {
    const [current] = await db.select({ status: units.status, saleModel: units.saleModel }).from(units).where(eq(units.id, params.unitId));
    if (current && params.wholeOnly && current.saleModel !== "whole") {
      throw new AppError("BUSINESS_RULE", "SPU and 50% fractional units can't be reserved whole until their booking rules are confirmed.");
    }
    throw new AppError(
      "CONFLICT",
      current ? `This unit is ${UNIT_STATUS_LABELS[current.status].toLowerCase()}, so it can't be changed that way.` : "Unit not found.",
      { details: { currentStatus: current?.status ?? null } },
    );
  }
  await db.insert(auditLogs).values({
    actorId: params.actorId,
    ip: params.ip ?? null,
    action: "unit.status",
    entity: "unit",
    entityId: params.unitId,
    before: { status: params.from.length === 1 ? params.from[0] : params.from },
    after: { status: params.to, source: params.source, reason: params.reason ?? null },
  });
}

/** For Bookings: claim an Available whole unit (FR-071 "creating a booking sets the unit to Reserved"). */
export async function reserveAvailableUnit(db: DbOrTx, unitId: string, actorId: string, reason: string, ip: string | null = null) {
  try {
    await transitionUnitStatus(db, { unitId, from: ["available"], to: "reserved", actorId, ip, source: "booking", reason, wholeOnly: true });
  } catch (error) {
    // Reword the generic transition message for the booking context; keep the code and details.
    if (error instanceof AppError && error.code === "CONFLICT") {
      const current = (error.details?.currentStatus as UnitStatus | null) ?? null;
      throw new AppError(
        "CONFLICT",
        current ? `This unit is no longer available (it is ${UNIT_STATUS_LABELS[current].toLowerCase()}). Choose another unit.` : "Unit not found.",
        { details: error.details },
      );
    }
    throw error;
  }
}
