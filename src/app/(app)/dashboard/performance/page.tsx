import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shell/module-placeholder";

export const metadata: Metadata = { title: "Performance" };

export default function PerformancePage() {
  return <ModulePlaceholder href="/dashboard/performance" />;
}
