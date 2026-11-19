import { eq } from "drizzle-orm";
import { businessToday } from "@/modules/bookings/today";
import { recordPayment } from "@/modules/finance/commands";
import { netPaid } from "@/modules/finance/ledger";
import { listPaymentMethods } from "@/modules/finance/queries";
import { resolvePaymentPlan } from "@/modules/projects/payment-plan";
import { getProposalSettings } from "@/modules/tasks/settings";
import type { Actor } from "@/server/auth/types";
import type { Database } from "@/server/db";
import { bookings, projects } from "@/server/db/schema";

/**
 * Closed Won needs the down payment posted by Accounts (19 Nov 2026). Tests that confirm a booking
 * post what is still missing first, as a Super Admin, in cash, dated today.
 */
export async function postDownPayment(db: Database, superAdmin: Actor, bookingId: string) {
  const [b] = await db.select({ totalSale: bookings.totalSale, projectId: bookings.projectId }).from(bookings).where(eq(bookings.id, bookingId));
  const [p] = await db.select({ paymentPlan: projects.paymentPlan }).from(projects).where(eq(projects.id, b.projectId));
  const plan = resolvePaymentPlan(p?.paymentPlan, await getProposalSettings(db));
  const required = Math.round(b.totalSale * plan.downPaymentPct) / 100;
  const missing = Math.round((required - (await netPaid(db, bookingId))) * 100) / 100;
  if (missing <= 0) return 0;
  const cash = (await listPaymentMethods(db, { activeOnly: true })).find((m) => m.name === "Cash")!;
  await recordPayment(db, superAdmin, { bookingId, type: "down_payment", amount: missing.toFixed(2), receivedOn: businessToday(), methodId: cash.id });
  return missing;
}
