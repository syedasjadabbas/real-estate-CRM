import { inArray, sql, eq } from "drizzle-orm";
import type { DbOrTx } from "@/modules/leads/support";
import { bookingPayments } from "@/server/db/schema";

/**
 * Net paid per booking = posted payments − reversals, always computed from the rows
 * (SECURITY_AND_PRIVACY.md §8: totals are never typed in or cached).
 */
const netExpr = sql<string>`coalesce(sum(case when ${bookingPayments.kind} = 'payment' then ${bookingPayments.amount} else -${bookingPayments.amount} end), 0)`;

export async function netPaid(db: DbOrTx, bookingId: string): Promise<number> {
  const [row] = await db.select({ net: netExpr }).from(bookingPayments).where(eq(bookingPayments.bookingId, bookingId));
  return Number(row?.net ?? 0);
}

export async function netPaidByBooking(db: DbOrTx, bookingIds: string[]): Promise<Map<string, number>> {
  if (bookingIds.length === 0) return new Map();
  const rows = await db
    .select({ bookingId: bookingPayments.bookingId, net: netExpr })
    .from(bookingPayments)
    .where(inArray(bookingPayments.bookingId, bookingIds))
    .groupBy(bookingPayments.bookingId);
  return new Map(rows.map((r) => [r.bookingId, Number(r.net)]));
}

/** Money is compared in paisa to avoid binary rounding. */
export const toPaisa = (n: number) => Math.round(n * 100);
