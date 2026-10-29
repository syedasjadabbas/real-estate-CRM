import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shell/module-placeholder";

export const metadata: Metadata = { title: "Tasks" };

export default function TasksPage() {
  return <ModulePlaceholder href="/dashboard/tasks" />;
}
