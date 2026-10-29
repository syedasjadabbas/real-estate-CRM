import { PageHeader, PageStack } from "@/components/shell/page-header";
import { findNavItem } from "@/config/navigation";

export default function ClientsLayout({ children }: LayoutProps<"/dashboard/clients">) {
  const item = findNavItem("/dashboard/clients")!;
  return (
    <PageStack>
      <PageHeader title={item.label} description={item.description} icon={item.icon} />
      {children}
    </PageStack>
  );
}
