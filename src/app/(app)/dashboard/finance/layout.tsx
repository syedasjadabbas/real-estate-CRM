import { Suspense } from "react";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { findNavItem } from "@/config/navigation";
import { FinanceTabs, type FinanceTab } from "@/features/finance/components/finance-tabs";
import { canDoFinance } from "@/modules/finance/policy";
import { requirePageUser } from "@/server/auth/current-user";

/** The tabs depend on the signed-in user's role, so they stream in; the header and the page don't wait. */
async function RoleTabs() {
  const actor = await requirePageUser();
  const tabs: FinanceTab[] = [
    canDoFinance(actor, "viewAll") ? { href: "/dashboard/finance", label: "Payments" } : null,
    canDoFinance(actor, "record") ? { href: "/dashboard/finance/record", label: "Record payment" } : null,
    canDoFinance(actor, "viewAll") || canDoFinance(actor, "decideReversal") ? { href: "/dashboard/finance/approvals", label: "Reversal approvals" } : null,
    canDoFinance(actor, "viewAll") ? { href: "/dashboard/finance/outstanding", label: "Outstanding" } : null,
    canDoFinance(actor, "viewAll") ? { href: "/dashboard/finance/entries", label: "Income & expenses" } : null,
    canDoFinance(actor, "viewAll") ? { href: "/dashboard/finance/reports", label: "Reports" } : null,
    canDoFinance(actor, "viewAll") ? { href: "/dashboard/finance/settings", label: "Settings" } : null,
  ].filter((t): t is FinanceTab => t !== null);
  return tabs.length ? <FinanceTabs tabs={tabs} /> : null;
}

export default function FinanceLayout({ children }: LayoutProps<"/dashboard/finance">) {
  const item = findNavItem("/dashboard/finance")!;
  return (
    <PageStack>
      <PageHeader title="Accounts & Finance" description={item.description} icon={item.icon} />
      <Suspense fallback={<div className="h-[52px] rounded-2xl border border-zinc-200/80 bg-white shadow-hairline" aria-hidden="true" />}>
        <RoleTabs />
      </Suspense>
      {children}
    </PageStack>
  );
}
