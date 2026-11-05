import { Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import type { LeadView } from "@/modules/leads/constants";
import { canDo, leadScope } from "@/modules/leads/policy";
import { leadLookups, listLeads } from "@/modules/leads/queries";
import type { Actor } from "@/server/auth/types";
import { leadsContext } from "../context";
import { formatDateTime } from "../format";
import { flattenParams, type SearchParams } from "../url";
import { LeadsTable } from "./leads-table";
import { LeadsToolbar } from "./leads-toolbar";
import { Pagination } from "./pagination";

/** Amber notice explaining the actor's lead scope (reference shows this for restricted users). */
export function ScopeNotice({ actor }: { actor: Actor }) {
  const scope = leadScope(actor.role);
  if (scope === "all") return null;
  return (
    <div className="rounded-2xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 shadow-hairline">
      <span className="font-semibold">{scope === "own" ? "Assigned leads only." : "Your teams' leads only."}</span>{" "}
      {scope === "own"
        ? "This list is limited to leads assigned to you."
        : "This list is limited to leads owned by you and the members of the teams you manage."}
    </div>
  );
}

export function NoProjectState() {
  return <EmptyState>No active project is available yet. An administrator needs to add a project first.</EmptyState>;
}

/** Gate shared by every Leads page: permission + selected project. */
export async function withLeadsAccess(render: (ctx: Awaited<ReturnType<typeof leadsContext>> & { projectId: string }) => Promise<ReactNode>) {
  const ctx = await leadsContext();
  if (!ctx.canView) return <RestrictedState />;
  if (!ctx.projectId) return <NoProjectState />;
  return render({ ...ctx, projectId: ctx.projectId });
}

export async function LeadsListView({
  view,
  title,
  description,
  pathname,
  searchParams,
  emptyMessage,
  before,
}: {
  view: LeadView;
  title: string;
  description: string;
  pathname: string;
  searchParams: Promise<SearchParams>;
  emptyMessage?: string;
  /** Extra content between the header and the toolbar (e.g. lost reasons). */
  before?: ReactNode;
}) {
  return withLeadsAccess(async ({ actor, db, projectId }) => {
    const params = flattenParams(await searchParams);
    const [result, lookups] = await Promise.all([
      listLeads(db, actor, projectId, { ...params, view }),
      leadLookups(db),
    ]);
    return (
      <section className="space-y-6" aria-label={title}>
        <PageHeader
          as="h2"
          title={title}
          description={description}
          actions={
            view === "all" && canDo(actor, "create") ? (
              <Link href="/dashboard/leads/new" className={buttonClasses({ variant: "primary", size: "lg", className: "px-5" })}>
                <Plus aria-hidden="true" className="size-4" />
                Add lead
              </Link>
            ) : null
          }
        />
        <ScopeNotice actor={actor} />
        {before}
        {result.teamName || result.query.createdFrom || result.query.createdTo ? (
          <p role="note" className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-900">
            Opened from the dashboard: {result.teamName ? `${result.teamName} · ` : ""}
            {result.query.createdFrom ? `created ${formatDateTime(result.query.createdFrom)} to ${formatDateTime(result.query.createdTo)}` : "the selected days"}. Clear the filters to see all leads.
          </p>
        ) : null}
        <LeadsToolbar params={params} total={result.total} lookups={lookups} />
        <LeadsTable
          rows={result.rows}
          pathname={pathname}
          params={params}
          showOriginal={view === "duplicates"}
          canEdit={canDo(actor, "edit")}
          now={result.generatedAt}
          emptyMessage={emptyMessage}
        />
        <Pagination page={result.page} pageCount={result.pageCount} total={result.total} params={params} />
      </section>
    );
  });
}
