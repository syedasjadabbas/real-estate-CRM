import { PageHeader, PageStack } from "@/components/shell/page-header";
import { findNavItem } from "@/config/navigation";

export default function ProjectsLayout({ children }: LayoutProps<"/dashboard/projects">) {
  const item = findNavItem("/dashboard/projects")!;
  return (
    <PageStack>
      <PageHeader title={item.label} description={item.description} icon={item.icon} />
      {children}
    </PageStack>
  );
}
