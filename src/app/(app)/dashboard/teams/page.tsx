import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shell/module-placeholder";

export const metadata: Metadata = { title: "Teams" };

export default function TeamsPage() {
  return <ModulePlaceholder href="/dashboard/teams" />;
}
