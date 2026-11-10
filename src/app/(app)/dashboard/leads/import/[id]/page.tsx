import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { StatusTag } from "@/components/ui/badge";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { ImportDecision } from "@/features/leads/components/import-forms";
import { withLeadsAccess } from "@/features/leads/components/list-view";
import { formatDateTime } from "@/features/leads/format";
import { getImportBatch } from "@/modules/leads/imports";
import { AppError } from "@/server/errors";

export const metadata: Metadata = { title: "Import batch" };

const ROW_TONE = { valid: "brand", created: "brand", duplicate: "amber", invalid: "rose", skipped: "neutral" } as const;

export default async function ImportBatchPage({ params }: PageProps<"/dashboard/leads/import/[id]">) {
  const { id } = await params;
  return withLeadsAccess(async ({ actor, db }) => {
    let detail: Awaited<ReturnType<typeof getImportBatch>>;
    try {
      detail = await getImportBatch(db, actor, id);
    } catch (e) {
      if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
      throw e;
    }
    const b = detail.batch;
    return (
      <section className="space-y-6" aria-label="Import batch">
        <PageHeader
          as="h2"
          title={`${b.fileName ?? "Import"} · ${detail.projectName}`}
          description={`Submitted by ${detail.uploaderName} on ${formatDateTime(b.createdAt)}. ${b.totalRows} rows: ${b.validRows} valid, ${b.duplicateRows} duplicate, ${b.invalidRows} invalid.`}
        />
        <PanelCard title="Decision">
          {b.status === "pending" ? (
            detail.canDecide ? (
              <ImportDecision batchId={b.id} />
            ) : (
              <p className="text-xs text-zinc-600">Waiting for a Super Admin to approve. No leads have been created.</p>
            )
          ) : (
            <p className="text-xs text-zinc-700">
              <StatusTag tone={b.status === "approved" ? "brand" : "rose"}>{b.status === "approved" ? "Approved" : "Rejected"}</StatusTag> by {detail.deciderName ?? "—"} on{" "}
              {b.decidedAt ? formatDateTime(b.decidedAt) : "—"}
              {b.status === "approved" ? ` · ${b.createdLeads} lead${b.createdLeads === 1 ? "" : "s"} created` : ""}
              {b.decisionNote ? ` · “${b.decisionNote}”` : ""}
            </p>
          )}
        </PanelCard>
        <PanelCard title={`Rows · ${detail.rows.length}`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left text-xs">
              <thead className="text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                <tr>
                  <th scope="col" className="px-2 py-2">Row</th>
                  <th scope="col" className="px-2 py-2">Name</th>
                  <th scope="col" className="px-2 py-2">Status</th>
                  <th scope="col" className="px-2 py-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {detail.rows.map((r) => (
                  <tr key={r.id} className="border-t border-zinc-100">
                    <td className="px-2 py-2">{r.rowNo}</td>
                    <td className="px-2 py-2 font-semibold">{String((r.data as Record<string, unknown>).name ?? "") || "—"}</td>
                    <td className="px-2 py-2">
                      <StatusTag tone={ROW_TONE[r.status]}>{r.status[0].toUpperCase() + r.status.slice(1)}</StatusTag>
                    </td>
                    <td className="px-2 py-2 text-zinc-600">
                      {r.leadId ? (
                        <Link href={`/dashboard/leads/${r.leadId}`} className="font-bold text-brand hover:underline">
                          Open lead
                        </Link>
                      ) : (
                        ((r.errors as string[] | null) ?? []).join("; ") || "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PanelCard>
      </section>
    );
  });
}
