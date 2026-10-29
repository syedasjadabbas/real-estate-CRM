import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { KanbanBoard } from "@/features/leads/components/kanban-board";
import { LeadsTable } from "@/features/leads/components/leads-table";
import { LeadsToolbar } from "@/features/leads/components/leads-toolbar";
import { ScopeNotice, withLeadsAccess } from "@/features/leads/components/list-view";
import { Pagination } from "@/features/leads/components/pagination";
import { flattenParams, withParams } from "@/features/leads/url";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { STAGE_LABELS } from "@/modules/leads/constants";
import { canDo } from "@/modules/leads/policy";
import { leadLookups, listLeads, pipelineBoard } from "@/modules/leads/queries";

export const metadata: Metadata = { title: "Sales pipeline" };

const PATH = "/dashboard/leads/pipeline";

export default function PipelinePage({ searchParams }: PageProps<"/dashboard/leads/pipeline">) {
  return withLeadsAccess(async ({ actor, db, projectId }) => {
    const params = flattenParams(await searchParams);
    const display = params.display === "table" ? "table" : "kanban";
    // Stage strip counts ignore the stage filter so every chip shows its full total.
    const { stage: selectedStage, ...withoutStage } = params;
    const [board, lookups, table] = await Promise.all([
      pipelineBoard(db, actor, projectId, withoutStage),
      leadLookups(db),
      display === "table" ? listLeads(db, actor, projectId, params) : Promise.resolve(null),
    ]);
    const visible = selectedStage ? board.columns.filter((c) => selectedStage.split(",").includes(c.stage)) : board.columns;
    const shownTotal = visible.reduce((sum, c) => sum + c.total, 0);
    const canEdit = canDo(actor, "edit");

    const viewLink = (value: "kanban" | "table") => (
      <Link
        href={withParams(PATH, params, { display: value === "kanban" ? null : value, page: null })}
        aria-current={display === value ? "true" : undefined}
        className={cn(
          "rounded-xl px-3.5 py-2 text-xs leading-4 font-bold transition-colors",
          display === value ? "bg-brand text-white shadow-hairline" : "text-zinc-700 hover:bg-zinc-100",
        )}
      >
        {value === "kanban" ? "Kanban" : "Table"}
      </Link>
    );

    return (
      <section className="space-y-6" aria-label="Sales pipeline">
        <PageHeader
          as="h2"
          title="Sales Pipeline"
          description="Board for stage movement, filtering, and managerial visibility."
          actions={
            <div className="flex items-center gap-1.5 rounded-2xl border border-zinc-200/80 bg-white p-1.5 shadow-hairline">
              <span className="px-1.5 text-[10px] font-black tracking-[0.1em] text-zinc-400 uppercase">View</span>
              {viewLink("kanban")}
              {viewLink("table")}
            </div>
          }
        />
        <ScopeNotice actor={actor} />
        <LeadsToolbar params={params} total={display === "table" ? table!.total : shownTotal} lookups={lookups} drawerTitle="Pipeline filters" />

        <Card className="overflow-hidden">
          <div className="flex items-center gap-2.5 border-b border-zinc-100 px-4 py-3.5">
            <h3 className="text-sm font-black">Stages</h3>
            <span className="text-[11px] text-zinc-600">Full pipeline · {formatInt(board.total)}</span>
          </div>
          <nav aria-label="Filter by stage" className="flex gap-1.5 overflow-x-auto p-1.5">
            <Link
              href={withParams(PATH, params, { stage: null, page: null })}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold",
                !selectedStage ? "bg-brand text-white shadow-hairline" : "text-zinc-700 hover:bg-zinc-100",
              )}
            >
              All <span className="font-black">{formatInt(board.total)}</span>
            </Link>
            {board.columns.map((c) => {
              const on = selectedStage?.split(",").includes(c.stage);
              return (
                <Link
                  key={c.stage}
                  href={withParams(PATH, params, { stage: on ? null : c.stage, page: null })}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold whitespace-nowrap",
                    on ? "bg-brand text-white shadow-hairline" : "text-zinc-700 hover:bg-zinc-100",
                  )}
                >
                  {STAGE_LABELS[c.stage]} <span className="font-black">{formatInt(c.total)}</span>
                </Link>
              );
            })}
          </nav>
        </Card>

        {display === "kanban" ? (
          <KanbanBoard columns={visible} canEdit={canEdit} now={board.generatedAt} />
        ) : (
          <>
            <LeadsTable rows={table!.rows} pathname={PATH} params={params} canEdit={canEdit} now={table!.generatedAt} />
            <Pagination page={table!.page} pageCount={table!.pageCount} total={table!.total} params={params} />
          </>
        )}
      </section>
    );
  });
}
