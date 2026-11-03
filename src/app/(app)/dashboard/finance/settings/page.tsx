import { sql } from "drizzle-orm";
import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { RestrictedState } from "@/components/ui/empty-state";
import { CategoriesPanel } from "@/features/finance/components/entry-forms";
import { MethodsPanel, PrefixPanel } from "@/features/finance/components/settings-panels";
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
  const [settings, methods, seq, categories] = await Promise.all([
    getFinanceSettings(db),
    listPaymentMethods(db),
    // Last value handed out (read-only; does not consume a number).
    db.execute<{ last_value: string; is_called: boolean }>(sql`select last_value, is_called from booking_payment_receipt_no_seq`),
    listCategories(db),
  ]);
  const row = seq.rows[0];
  const next = row ? Number(row.last_value) + (row.is_called ? 1 : 0) : 1;
  const canEdit = canDoFinance(actor, "settings");

  return (
    <section className="space-y-6" aria-label="Finance settings">
      <PageHeader as="h2" title="Finance settings" description="Proposed defaults pending client confirmation: receipt prefixes and payment methods." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <PrefixPanel initial={settings} canEdit={canEdit} nextExample={String(next)} />
        <MethodsPanel methods={methods} canEdit={canEdit} />
        <CategoriesPanel categories={categories} canEdit={canEdit} />
      </div>
    </section>
  );
}
