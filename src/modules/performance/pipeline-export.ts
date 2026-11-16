import { LEAD_STAGES, STAGE_LABELS } from "@/modules/leads/constants";
import type { Actor } from "@/server/auth/types";
import { toCsv, type CsvValue } from "@/server/csv";
import type { Database } from "@/server/db";
import { auditLogs } from "@/server/db/schema";
import { businessToday } from "@/modules/bookings/today";
import { performanceReport, pipelineByAgent } from "./service";

/** Talk time from seconds (owner, 16 Nov 2026): "1h 05m", "12m 30s", "45s"; "—" when nothing is timed. */
export function formatTalkTime(seconds: number, timedCalls: number) {
  if (!timedCalls) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/**
 * "Pipeline by agent" download (owner, 16 Nov 2026): the table as shown, one row per agent with each
 * stage and a total, for one project and the same scope, team and name search as the page, plus talk
 * time: the length of the agent's call recordings in the date range. Audited.
 */
export async function pipelineCsv(db: Database, actor: Actor & { ip?: string | null }, rawQuery: unknown, project: { id: string; name: string }) {
  const report = await performanceReport(db, actor, rawQuery);
  const counts = await pipelineByAgent(db, report.matched.map((r) => r.userId), project.id);
  const rows: CsvValue[][] = report.matched.map((r) => {
    const c = counts.get(r.userId)!;
    return [r.name, ...LEAD_STAGES.map((s) => c[s]), LEAD_STAGES.reduce((n, s) => n + c[s], 0), formatTalkTime(r.callSeconds, r.callsTimed), r.calls];
  });
  const today = businessToday();
  const filename = `pipeline-${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${today}.csv`;
  await db.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: "performance.pipeline_export", entity: "project", entityId: project.id, before: null, after: { file: filename, agents: rows.length, team: report.team, search: report.search || null, from: report.range.from, to: report.range.to } });
  return { filename, body: toCsv(["Agent", ...LEAD_STAGES.map((s) => STAGE_LABELS[s]), "Total", `Talk time ${report.range.from} to ${report.range.to}`, "Calls in range"], rows) };
}
