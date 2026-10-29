import { PageHeader, PageStack } from "@/components/shell/page-header";
import { findNavItem } from "@/config/navigation";

export default function BookingsLayout({ children }: LayoutProps<"/dashboard/bookings">) {
  const item = findNavItem("/dashboard/bookings")!;
  return (
    <PageStack>
      <PageHeader title={item.label} description={item.description} icon={item.icon} />
      {children}
    </PageStack>
  );
}
