import type { SessionUser } from "@/lib/session";
import type { DashboardData, DashboardFilters } from "../types";
import { DashboardHero } from "./dashboard-hero";
import { DistributionCard } from "./distribution-card";
import { ExecutiveEssentials } from "./executive-essentials";
import { InstantInsights } from "./instant-insights";
import { LeadsByProject } from "./leads-by-project";
import { LostLeads } from "./lost-leads";
import { MyTargets } from "./my-targets";
import { PipelineHealth } from "./pipeline-health";

/** Dashboard layout in the reference's block order. */
export function DashboardView({ data, user, filters }: { data: DashboardData; user: SessionUser | null; filters?: DashboardFilters }) {
  // Agents see only their own figures: KPIs from their leads, their score and targets. Project-wide
  // and team panels (pipeline health, sources, channels, lost by team) are for Admins (13 Nov 2026).
  const own = user?.role === "agent";
  return (
    <div className="space-y-6">
      <DashboardHero user={user} isSample={data.isSample} live={Boolean(data.snapshotAt)} />
      <ExecutiveEssentials data={data} filters={filters} own={own} />
      {/* Targets are personal goals: shown on an agent's own dashboard only (15 Nov 2026). Their score is
          an Executive Essentials box, so agents have no Instant Insights section (23 Nov 2026). */}
      {own ? <MyTargets targets={data.targets} /> : null}
      <LeadsByProject rows={data.projectLeads} own={own} />
      {own ? null : (
        <>
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
      <LostLeads data={data.snapshotAt ? data.lost : null} />
        </>
      )}
    </div>
  );
}
