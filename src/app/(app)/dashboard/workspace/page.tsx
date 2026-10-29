import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shell/module-placeholder";

export const metadata: Metadata = { title: "My workplace" };

export default function WorkspacePage() {
  return <ModulePlaceholder href="/dashboard/workspace" />;
}
