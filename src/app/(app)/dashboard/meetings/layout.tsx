import { PageHeader, PageStack } from "@/components/shell/page-header";
import { findNavItem } from "@/config/navigation";

export default function MeetingsLayout({ children }: LayoutProps<"/dashboard/meetings">) {
  const item = findNavItem("/dashboard/meetings")!;
  return (
    <PageStack>
      <PageHeader title="Meetings" description={item.description} icon={item.icon} />
      {children}
    </PageStack>
  );
}
