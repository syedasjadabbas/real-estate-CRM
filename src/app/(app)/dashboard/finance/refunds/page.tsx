import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { RestrictedState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { RefundsList } from "@/features/finance/components/refund-forms";
import { formatPrice } from "@/features/inventory/format";
import { businessToday } from "@/modules/bookings/today";
import { canDoFinance } from "@/modules/finance/policy";
import { listPaymentMethods } from "@/modules/finance/queries";
import { refundsDue } from "@/modules/finance/refunds";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Finance · Refunds" };

/** Refunds owed on cancelled bookings (paid − deduction kept), and what Accounts has paid back. */
export default async function RefundsPage() {
  const actor = await requirePageUser();
  if (!canDoFinance(actor, "viewAll")) return <RestrictedState />;
  const db = getDb();
  const [rows, methods] = await Promise.all([refundsDue(db, actor, { open: false }), listPaymentMethods(db, { activeOnly: true })]);
  const open = rows.filter((r) => r.remaining > 0);
  const left = open.reduce((n, r) => n + Math.round(r.remaining * 100), 0) / 100;
  const paid = rows.reduce((n, r) => n + Math.round(r.refunded * 100), 0) / 100;
  return (
    <section className="space-y-6" aria-label="Refunds">
      <PageHeader
        as="h2"
        title="Refunds"
        description="When a paid booking is cancelled, the Admin enters the deduction kept and the rest is owed back to the buyer. Record each payment back here; it lowers the booking's net paid and shows in the refunds & reversals report on the day it is paid."
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MiniStat label="Refunds still due" value={formatPrice(left)} caption={`${open.length} booking${open.length === 1 ? "" : "s"}`} />
        <MiniStat label="Refunded so far" value={formatPrice(paid)} caption="All cancelled bookings" />
        <MiniStat label="Deductions kept" value={formatPrice(rows.reduce((n, r) => n + Math.round(r.deduction * 100), 0) / 100)} caption="All cancelled bookings" />
      </div>
      <RefundsList rows={rows} methods={methods} today={businessToday()} canRecord={canDoFinance(actor, "record")} />
    </section>
  );
}
