import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shell/module-placeholder";

export const metadata: Metadata = { title: "Targets" };

export default function TargetsPage() {
  return <ModulePlaceholder href="/dashboard/targets" />;
}
