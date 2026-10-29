import { FlaskConical } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardView } from "@/features/dashboard/components/dashboard-view";
import { dashboardSampleData } from "@/features/dashboard/sample-data.dev";

export const metadata: Metadata = {
  title: "Dashboard preview (sample data)",
  robots: { index: false, follow: false },
};

/**
 * Development-only route: renders the dashboard with clearly labelled sample data so its
 * density can be compared with the reference. Returns 404 in production builds.
 */
export default function DashboardPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="space-y-4">
      <div
        role="note"
        className="flex items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900"
      >
        <FlaskConical aria-hidden="true" className="size-4 shrink-0" />
        Development preview — sample data for layout review only. Not connected to any database.
      </div>
      <DashboardView data={dashboardSampleData} user={null} />
    </div>
  );
}
