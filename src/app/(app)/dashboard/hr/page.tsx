import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shell/module-placeholder";

export const metadata: Metadata = { title: "HR" };

export default function HrPage() {
  return <ModulePlaceholder href="/dashboard/hr" />;
}
