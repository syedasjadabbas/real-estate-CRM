import type { DashboardData } from "./types";

/**
 * DEVELOPMENT-ONLY SAMPLE DATA.
 * Used solely by /dev/dashboard-preview to compare layout density with the reference CRM.
 * Names are generic placeholders; nothing here comes from a real database or real people.
 * Never import this file from production routes.
 */
export const dashboardSampleData: DashboardData = {
  isSample: true,
  snapshotAt: "2026-10-28T14:51:39Z",
  kpis: {
    totalLeads: 2680,
    openPct: 91.4,
    wonPct: 0,
    lostPct: 8.6,
    conversionRate: 0,
    winOnDecided: 0,
    openPipeline: 2449,
    openPipelinePct: 91.4,
    won: 0,
    lost: 231,
    attritionPct: 8.6,
    regenerated: 84,
    awaitingFirstTouch: 1,
  },
  teams: [{ id: "sample-team", name: "Sample Team" }],
  activeProjects: 1,
  topProjects: [{ id: "sample-project", label: "Sample Project", count: 2680 }],
  insights: { teams: 0, avgScore: 0, meetings30d: 6, meetings6m: 21, teamMeetings: 0, bookings: 0 },
  insightsUpdatedAt: "2026-10-28T14:27:46Z",
  teamScores: [],
  teamOutput: [],
  meetingMix: [
    { id: "online", label: "Online", count: 4, color: "sky" },
    { id: "physical", label: "Physical", count: 2, color: "orange" },
  ],
  targets: {
    today: [{ label: "Calls", actual: 15, target: null }],
    week: [{ label: "Calls", actual: 31, target: null }],
    month: [
      { label: "Calls", actual: 460, target: 2000 },
      { label: "Meetings", actual: 5, target: 40 },
      { label: "Sold (sq ft)", actual: 0, target: 700 },
    ],
  },
  pipelineHealth: {
    stale: 2314,
    noMeeting: 2443,
    meetingsDone: 6,
    rows: [
      { age: "0-1M", buckets: [114, 0, 0, 0, 0], leads: 114, meetings: 3, avgPerOwner: 3 },
      { age: "1-2M", buckets: [536, 0, 0, 0, 0], leads: 536, meetings: 5, avgPerOwner: 5 },
      { age: "2-3M", buckets: [228, 0, 0, 0, 0], leads: 228, meetings: 2, avgPerOwner: 2 },
      { age: "3-5M", buckets: [342, 1, 0, 0, 0], leads: 343, meetings: 4, avgPerOwner: 4 },
      { age: "5-8M", buckets: [377, 0, 0, 0, 0], leads: 377, meetings: 2, avgPerOwner: 2 },
      { age: "8-12M", buckets: [703, 0, 0, 0, 0], leads: 703, meetings: 2, avgPerOwner: 2 },
      { age: "12M+", buckets: [145, 0, 0, 0, 0], leads: 145, meetings: 0, avgPerOwner: 0 },
    ],
  },
  leadSources: [
    { id: "s1", label: "Old CRM (Meta)", count: 1189 },
    { id: "s2", label: "Facebook", count: 759 },
    { id: "s3", label: "CEO data", count: 360 },
    { id: "s4", label: "TikTok", count: 251 },
    { id: "s5", label: "Whatsapp", count: 108 },
    { id: "s6", label: "Reference", count: 9 },
    { id: "s7", label: "Personal", count: 2 },
    { id: "s8", label: "Walk in", count: 1 },
    { id: "s9", label: "Cold data", count: 1 },
  ],
  inboundChannels: [
    { id: "c1", label: "Manual", count: 1690 },
    { id: "c2", label: "Meta", count: 799 },
    { id: "c3", label: "Tiktok", count: 191 },
  ],
  recentLeads: [
    { id: "l1", name: "Sample Lead One", status: "Contact Attempted", inbound: "Manual", owner: "Sample Agent", createdAt: "2026-10-28T05:55:00Z" },
    { id: "l2", name: "Sample Lead Two", status: "New Lead", inbound: "Tiktok", owner: "Sample Agent", createdAt: "2026-10-28T05:31:00Z" },
    { id: "l3", name: "Sample Lead Three", status: "Contacted", inbound: "Meta", owner: "Sample Agent", createdAt: "2026-10-28T05:06:00Z" },
    { id: "l4", name: "Sample Lead Four", status: "Lost Lead", inbound: "Meta", owner: "Sample Agent", createdAt: "2026-10-28T05:01:00Z" },
    { id: "l5", name: "Sample Lead Five", status: "Qualified Lead", inbound: "Meta", owner: "Sample Agent", createdAt: "2026-10-27T13:01:00Z" },
    { id: "l6", name: "Sample Lead Six", status: "Future Opportunity", inbound: "Tiktok", owner: "Sample Agent", createdAt: "2026-10-27T11:46:00Z" },
  ],
};
