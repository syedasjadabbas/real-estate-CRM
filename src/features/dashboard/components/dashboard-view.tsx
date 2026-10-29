import type { SessionUser } from "@/lib/session";
import type { DashboardData } from "../types";
import { DashboardHero } from "./dashboard-hero";
import { DistributionCard } from "./distribution-card";
import { ExecutiveEssentials } from "./executive-essentials";
import { InstantInsights } from "./instant-insights";
import { PipelineHealth } from "./pipeline-health";
import { RecentLeads } from "./recent-leads";

/** Dashboard layout in the reference's block order. */
export function DashboardView({ data, user }: { data: DashboardData; user: SessionUser | null }) {
  return (
    <div className="space-y-6">
      <DashboardHero user={user} isSample={data.isSample} />
      <ExecutiveEssentials data={data} />
      <InstantInsights data={data} />
      <PipelineHealth data={data.pipelineHealth} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <DistributionCard
          title="Lead sources"
          badge="Acquisition"
          description="Engaged leads volume by acquisition source"
          rows={data.leadSources}
          emptyMessage="No lead sources recorded yet."
        />
        <DistributionCard
          title="Inbound channels"
          badge="Origin"
          description="Channel origin distribution across pipeline"
          rows={data.inboundChannels}
          emptyMessage="No inbound channels recorded yet."
        />
      </div>
      <RecentLeads leads={data.recentLeads} />
    </div>
  );
}
