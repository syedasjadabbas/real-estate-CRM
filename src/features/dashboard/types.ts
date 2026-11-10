/**
 * Dashboard view model. Every field is nullable/empty so the page can render honest
 * empty states until the PostgreSQL-backed analytics are connected.
 */
export type RangeKey = "24h" | "7d" | "30d" | "mtd" | "6m" | "custom";

export type ExecutiveKpis = {
  totalLeads: number;
  openPct: number;
  wonPct: number;
  lostPct: number;
  conversionRate: number;
  winOnDecided: number;
  openPipeline: number;
  openPipelinePct: number;
  won: number;
  lost: number;
  attritionPct: number;
  regenerated: number;
  awaitingFirstTouch: number;
};

export type NamedCount = { id: string; label: string; count: number };

/** FR-016: lost leads per team, with the owners (agents) inside it. */
export type LostTeam = { id: string; label: string; count: number; agents: NamedCount[] };
export type LostBreakdown = { byTeam: LostTeam[] };

export type InsightTotals = {
  teams: number;
  avgScore: number;
  meetings30d: number;
  meetings6m: number;
  teamMeetings: number;
  bookings: number;
};

export type MeetingFormat = { id: string; label: string; count: number; color: "sky" | "orange" };

export type TargetLine = { label: string; actual: number; target: number | null };
export type TargetPeriods = { today: TargetLine[]; week: TargetLine[]; month: TargetLine[] };

export type AgingRow = {
  age: string;
  /** Lead counts per meeting bucket: 0-1, 2-5, 6-10, 11-20, 20+ */
  buckets: [number, number, number, number, number];
  leads: number;
  meetings: number;
  avgPerOwner: number;
};

export type PipelineHealth = {
  stale: number;
  noMeeting: number;
  meetingsDone: number;
  rows: AgingRow[];
};

/** Range and team chosen in the URL (?range=&from=&to=&team=). */
export type DashboardFilters = { range: RangeKey; from?: string; to?: string; team?: string };

export type DashboardData = {
  /** True only for the development preview route. */
  isSample: boolean;
  snapshotAt: string | null;
  kpis: ExecutiveKpis | null;
  teams: { id: string; name: string }[];
  activeProjects: number | null;
  topProjects: NamedCount[];
  insights: InsightTotals | null;
  insightsUpdatedAt: string | null;
  teamScores: NamedCount[];
  teamOutput: { id: string; label: string; meetings: number; bookings: number }[];
  meetingMix: MeetingFormat[];
  targets: TargetPeriods | null;
  pipelineHealth: PipelineHealth | null;
  leadSources: NamedCount[];
  inboundChannels: NamedCount[];
  lost: LostBreakdown | null;
  /** Query that opens the leads behind these figures: same window and team (FR-010). */
  listParams?: Record<string, string>;
};

export const emptyDashboardData: DashboardData = {
  isSample: false,
  snapshotAt: null,
  kpis: null,
  teams: [],
  activeProjects: null,
  topProjects: [],
  insights: null,
  insightsUpdatedAt: null,
  teamScores: [],
  teamOutput: [],
  meetingMix: [],
  targets: null,
  pipelineHealth: null,
  leadSources: [],
  inboundChannels: [],
  lost: null,
};
