import { PageHeader, PageStack } from "@/components/shell/page-header";
import { findNavItem } from "@/config/navigation";

export default function TasksLayout({ children }: LayoutProps<"/dashboard/tasks">) {
  const item = findNavItem("/dashboard/tasks")!;
  return (
    <PageStack>
      <PageHeader title="Task Management" description={item.description} icon={item.icon} />
      {children}
    </PageStack>
  );
}
