import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { DocumentsPanel } from "@/features/documents/components/documents-panel";
import { EntryForm, VoidEntryForm } from "@/features/finance/components/entry-forms";
import { formatListedOn, formatPrice } from "@/features/inventory/format";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime } from "@/features/leads/format";
import { ENTRY_KIND_LABELS, getEntry, listCategories, listEntryFiles } from "@/modules/finance/entries";
import { canDoFinance } from "@/modules/finance/policy";
import { listPaymentMethods } from "@/modules/finance/queries";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";

export const metadata: Metadata = { title: "Finance · Entry" };

const ACTIONS: Record<string, string> = {
  "finance.income_create": "Income recorded",
  "finance.expense_create": "Expense recorded",
  "finance.income_update": "Edited",
  "finance.expense_update": "Edited",
  "finance.income_void": "Voided",
  "finance.expense_void": "Voided",
  "finance.entry_attachment": "Attachment added",
};

export default async function EntryPage({ params }: PageProps<"/dashboard/finance/entries/[id]">) {
  const actor = await requirePageUser();
  if (!canDoFinance(actor, "viewAll")) return <RestrictedState />;
  const { id } = await params;
  const db = getDb();
  let data: Awaited<ReturnType<typeof getEntry>>;
  try {
    data = await getEntry(db, actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { entry, trail } = data;
  const [attachments, categories, methods] = await Promise.all([listEntryFiles(db, actor, id), listCategories(db), listPaymentMethods(db, { activeOnly: true })]);
  const canRecord = canDoFinance(actor, "record");
  const editable = canRecord && !entry.voidedAt;

  return (
    <section className="space-y-6" aria-label={`${ENTRY_KIND_LABELS[entry.kind]} entry`}>
      <PageHeader
        as="h2"
        title={`${ENTRY_KIND_LABELS[entry.kind]} · ${formatPrice(entry.amount)}`}
        description={`${entry.categoryName} · ${formatListedOn(entry.entryDate)}${entry.voidedAt ? " · Voided" : ""}`}
        actions={
          <Link href="/dashboard/finance/entries" className={buttonClasses({ variant: "secondary", size: "lg" })}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back
          </Link>
        }
      />
      {entry.voidedAt ? (
        <p role="note" className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700">
          Voided by {entry.voidedByName ?? "—"} on {formatDateTime(entry.voidedAt)}: {entry.voidReason}. It stays on record and is left out of totals.
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          <PanelCard title={editable ? "Edit entry" : "Entry"}>
            {editable ? (
              <EntryForm
                entryId={entry.id}
                categories={categories}
                methods={methods.map((m) => ({ id: m.id, name: m.name }))}
                initial={{ kind: entry.kind, categoryId: entry.categoryId, amount: String(entry.amount), entryDate: entry.entryDate, methodId: entry.methodId ?? "", reference: entry.reference ?? "", payee: entry.payee ?? "", note: entry.note ?? "" }}
              />
            ) : (
              <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                {[
                  ["Method", entry.methodName ?? "—"],
                  ["Reference", entry.reference ?? "—"],
                  ["Payee", entry.payee ?? "—"],
                  ["Note", entry.note ?? "—"],
                  ["Recorded", `${formatDateTime(entry.createdAt)} · ${entry.createdByName ?? "—"}`],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[10px] font-black tracking-[0.1em] text-zinc-400 uppercase">{k}</dt>
                    <dd className="mt-0.5 font-semibold text-zinc-900">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </PanelCard>
          <PanelCard title={`History · ${trail.length}`}>
            {trail.length === 0 ? (
              <EmptyState size="sm">No history.</EmptyState>
            ) : (
              <ol className="space-y-2">
                {trail.map((t) => (
                  <li key={t.id} className="rounded-xl border border-zinc-200/80 px-3 py-2 text-xs shadow-hairline">
                    <p className="font-bold">{ACTIONS[t.action] ?? t.action}</p>
                    {t.action.endsWith("_update") ? (
                      <p className="break-words text-zinc-700">
                        {Object.keys((t.after ?? {}) as Record<string, unknown>)
                          .map((k) => `${k}: ${String(((t.before ?? {}) as Record<string, unknown>)[k] ?? "—")} → ${String(((t.after ?? {}) as Record<string, unknown>)[k] ?? "—")}`)
                          .join("; ")}
                      </p>
                    ) : null}
                    <p className="text-[11px] text-zinc-500">
                      {formatDateTime(t.createdAt)} · {t.actorName ?? "System"}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </PanelCard>
        </div>
        <div className="space-y-6">
          <DocumentsPanel
            documents={attachments}
            canUpload={editable}
            uploadUrl={`/api/v1/finance/entries/${entry.id}/files`}
            fileBase="/api/v1/finance/entry-files"
            text={{ title: "Attachments", empty: "No attachments.", field: "Attach a receipt or document", button: "Attach file", uploaded: "Attachment added.", noun: "Attachments" }}
          />
          {editable ? (
            <PanelCard title="Void entry">
              <VoidEntryForm entryId={entry.id} />
            </PanelCard>
          ) : null}
        </div>
      </div>
    </section>
  );
}
