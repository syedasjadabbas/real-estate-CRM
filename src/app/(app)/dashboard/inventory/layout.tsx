import { PageHeader, PageStack } from "@/components/shell/page-header";
import { findNavItem } from "@/config/navigation";

export default function InventoryLayout({ children }: LayoutProps<"/dashboard/inventory">) {
  const item = findNavItem("/dashboard/inventory")!;
  return (
    <PageStack>
      <PageHeader title={item.label} description={item.description} icon={item.icon} />
      {children}
    </PageStack>
  );
}
