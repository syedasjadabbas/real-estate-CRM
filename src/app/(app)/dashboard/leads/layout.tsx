import { PageHeader, PageStack } from "@/components/shell/page-header";
import { findNavItem } from "@/config/navigation";
import { LeadsTabs } from "@/features/leads/components/leads-tabs";

export default function LeadsLayout({ children }: LayoutProps<"/dashboard/leads">) {
  const item = findNavItem("/dashboard/leads")!;
  return (
    <PageStack>
      <PageHeader title={item.label} description={item.description} icon={item.icon} />
      <LeadsTabs />
      {children}
    </PageStack>
  );
}
