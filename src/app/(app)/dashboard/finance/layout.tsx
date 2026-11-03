import { PageHeader, PageStack } from "@/components/shell/page-header";
import { findNavItem } from "@/config/navigation";
import { FinanceTabs, type FinanceTab } from "@/features/finance/components/finance-tabs";
import { canDoFinance } from "@/modules/finance/policy";
import { requirePageUser } from "@/server/auth/current-user";

export default async function FinanceLayout({ children }: LayoutProps<"/dashboard/finance">) {
  const item = findNavItem("/dashboard/finance")!;
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

  return (
    <PageStack>
      <PageHeader title="Accounts & Finance" description={item.description} icon={item.icon} />
      {tabs.length ? <FinanceTabs tabs={tabs} /> : null}
      {children}
    </PageStack>
  );
}
