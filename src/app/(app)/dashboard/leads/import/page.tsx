import type { Metadata } from "next";
import { Download } from "lucide-react";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { StatusTag } from "@/components/ui/badge";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { ImportUploadForm } from "@/features/leads/components/import-forms";
import { withLeadsAccess } from "@/features/leads/components/list-view";
import { formatDateTime } from "@/features/leads/format";
import { formatInt } from "@/lib/format";
import { canDecideImport, canSubmitImport, listImportBatches } from "@/modules/leads/imports";
import { activeProjects } from "@/modules/leads/queries";

export const metadata: Metadata = { title: "Lead imports" };

const TONE = { pending: "amber", approved: "brand", rejected: "rose" } as const;

/** Submit lead files for approval; a Super Admin sees every batch and decides them. */
export default async function LeadImportsPage() {
  return withLeadsAccess(async ({ actor, db, projectId }) => {
    if (!canSubmitImport(actor)) return <RestrictedState />;
    const [projects, batches] = [await activeProjects(db), await listImportBatches(db, actor)];
    return (
      <section className="space-y-6" aria-label="Lead imports">
        <PageHeader
          as="h2"
          title="Lead imports"
          description={
            canDecideImport(actor)
              ? "Batches submitted by agents and managers. Nothing is created until you approve a batch."
              : "Submit a file of leads. A Super Admin approves each batch before any lead is created or assigned."
          }
        />
        <PanelCard title="Submit a batch">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-3 py-2.5">
            <p className="text-xs text-zinc-600">
              Fill in the sample file and upload it. <span className="font-bold text-zinc-800">name, phone and source</span> are required; the other columns can stay blank.
            </p>
            <a href="/api/v1/lead-imports/template" download className={buttonClasses({ variant: "secondary", className: "h-[33px] px-3 text-xs" })}>
              <Download aria-hidden="true" className="size-3.5" />
              Download sample CSV
            </a>
          </div>
          <ImportUploadForm projects={projects} defaultProjectId={projectId} />
        </PanelCard>
        <PanelCard title={canDecideImport(actor) ? "All batches" : "Your batches"}>
          {batches.length === 0 ? (
            <EmptyState size="sm">No batches yet.</EmptyState>
          ) : (
            <ul className="space-y-2" aria-label="Import batches">
              {batches.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200/80 px-3 py-2.5 text-xs shadow-hairline">
                  <div className="min-w-0">
                    <Link href={`/dashboard/leads/import/${b.id}`} className="font-bold text-zinc-900 hover:text-brand hover:underline">
                      {b.fileName ?? "Import"} · {b.projectName}
                    </Link>
                    <p className="text-[11px] text-zinc-500">
                      {b.uploaderName} · {formatDateTime(b.createdAt)} · {formatInt(b.validRows)} valid, {formatInt(b.duplicateRows)} duplicate, {formatInt(b.invalidRows)} invalid
                      {b.status === "approved" ? ` · ${formatInt(b.createdLeads)} created` : ""}
                    </p>
                  </div>
                  <StatusTag tone={TONE[b.status]}>{b.status === "pending" ? "Pending approval" : b.status === "approved" ? "Approved" : "Rejected"}</StatusTag>
                </li>
              ))}
            </ul>
          )}
        </PanelCard>
      </section>
    );
  });
}
