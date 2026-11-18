import { sql } from "drizzle-orm";
import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { RestrictedState } from "@/components/ui/empty-state";
import { CategoriesPanel } from "@/features/finance/components/entry-forms";
import { BookingNumberPanel, MethodsPanel, PaymentTermsPanel, PrefixPanel } from "@/features/finance/components/settings-panels";
import { DOWN_PAYMENT_DUE_DAYS, DOWN_PAYMENT_GRACE_DAYS, INSTALLMENT_GRACE_DAYS } from "@/modules/finance/constants";
import { listCategories } from "@/modules/finance/entries";
import { canDoFinance } from "@/modules/finance/policy";
import { getFinanceSettings, listPaymentMethods } from "@/modules/finance/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Finance · Settings" };

export default async function FinanceSettingsPage() {
  const actor = await requirePageUser();
  if (!canDoFinance(actor, "viewAll")) return <RestrictedState />;
  const db = getDb();
  const [settings, methods, seq, categories, bookingSeq] = await Promise.all([
    getFinanceSettings(db),
    listPaymentMethods(db),
    // Last value handed out (read-only; does not consume a number).
    db.execute<{ last_value: string; is_called: boolean }>(sql`select last_value, is_called from booking_payment_receipt_no_seq`),
    listCategories(db),
    // Booking numbers (18 Nov 2026): the next one, and the highest used so far.
    db.execute<{ next: string; highest: string | null }>(
      sql`select (case when is_called then last_value + 1 else last_value end)::text as next, (select max(ref_no) from bookings)::text as highest from booking_ref_no_seq`,
    ),
  ]);
  const bookingRow = bookingSeq.rows[0];
  const row = seq.rows[0];
  const next = row ? Number(row.last_value) + (row.is_called ? 1 : 0) : 1;
  const canEdit = canDoFinance(actor, "settings");

  return (
    <section className="space-y-6" aria-label="Finance settings">
      <PageHeader as="h2" title="Finance settings" description="Receipt and booking numbering, payment grace periods, payment methods and categories. Only a Super Admin changes them." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <PrefixPanel initial={settings} canEdit={canEdit} nextExample={String(next)} />
        <BookingNumberPanel prefix={settings.booking_prefix} next={Number(bookingRow?.next ?? 1)} highest={bookingRow?.highest ? Number(bookingRow.highest) : null} canEdit={canEdit} />
        <PaymentTermsPanel
          initial={{ installment_grace_days: settings.installment_grace_days, down_payment_due_days: settings.down_payment_due_days, down_payment_grace_days: settings.down_payment_grace_days }}
          defaults={{ installment_grace_days: INSTALLMENT_GRACE_DAYS, down_payment_due_days: DOWN_PAYMENT_DUE_DAYS, down_payment_grace_days: DOWN_PAYMENT_GRACE_DAYS }}
          canEdit={canEdit}
        />
        <MethodsPanel methods={methods} canEdit={canEdit} />
        <CategoriesPanel categories={categories} canEdit={canEdit} />
      </div>
    </section>
  );
}
