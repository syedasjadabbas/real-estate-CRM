import { Download, ScrollText } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { actionLabel, entityLabel } from "@/modules/audit/labels";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { AuditFilters, AuditSortHeader, SettingsTabs } from "@/features/audit/components/audit-controls";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { Pagination } from "@/features/leads/components/pagination";
import { formatDateTime } from "@/features/leads/format";
import { flattenParams } from "@/features/leads/url";
import { canViewBackups } from "@/modules/backups/policy";
import { canViewAuditLog, listAuditLogs, type AuditRow, type AuditSortColumn } from "@/modules/audit/service";
import { requirePageUser } from "@/server/auth/current-user";
import { ROLE_LABELS, type Role } from "@/server/auth/types";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Audit log" };

const PATH = "/dashboard/settings/audit-log";

function Change({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-black tracking-[0.05em] text-zinc-500 uppercase">{label}</p>
      <pre className="mt-0.5 max-h-60 overflow-auto rounded-lg bg-zinc-50 p-2 text-[11px] leading-4 break-words whitespace-pre-wrap text-zinc-800">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

/** Record type, then its name linked to its page (16 Nov 2026); the id only when the record is gone. */
function RecordCell({ row }: { row: AuditRow }) {
  const rec = row.record;
  return (
    <>
      <span className="block text-[10px] font-bold tracking-[0.05em] text-zinc-500 uppercase">{entityLabel(row.entity)}</span>
      {rec ? (
        rec.href ? (
          <Link href={rec.href} className="block truncate font-semibold text-brand hover:underline" title={rec.name}>
            {rec.name}
          </Link>
        ) : (
          <span className="block truncate font-semibold" title={rec.name}>
            {rec.name}
          </span>
        )
      ) : row.entityId ? (
        <span className="block truncate font-mono text-[11px] text-zinc-400" title="This record no longer exists, or has no name">
          {row.entityId}
        </span>
      ) : null}
    </>
  );
}

/** Settings → Audit log (FR-008, SECURITY_AND_PRIVACY §3): read-only, Super Admin and Admin. */
export default async function AuditLogPage({ searchParams }: PageProps<"/dashboard/settings/audit-log">) {
  const actor = await requirePageUser();
  if (!canViewAuditLog(actor)) return <RestrictedState />;
  const params = flattenParams(await searchParams);
  const data = await listAuditLogs(getDb(), actor, params);
  const sortHeader = (column: AuditSortColumn, label: string) => (
    <th scope="col" className="py-2 pr-3" aria-sort={data.query.sort === column ? (data.query.dir === "asc" ? "ascending" : "descending") : undefined}>
      <AuditSortHeader path={PATH} params={params} column={column} label={label} sort={data.query.sort} dir={data.query.dir} />
    </th>
  );
  const filtered = Boolean(params.q || params.actor || params.entity || params.action || params.from || params.to);

  return (
    <PageStack>
      <PageHeader
        title="Audit log"
        description="Who did what, and when. Nobody can edit or delete these entries. Times are Pakistan time. Click a record to open it, or View changes to see what changed."
        icon={ScrollText}
      />
      <SettingsTabs active="audit" showBackups={canViewBackups(actor)} />
      <PanelCard title={`Entries · ${data.total}`}>
        <div className="mb-3 flex justify-end">
          <a
            href={`/api/v1/audit/export?${new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([k, v]) => v && ["q", "actor", "entity", "action", "from", "to"].includes(k))))}`}
            className={buttonClasses({ variant: "secondary", className: "h-[33px] px-3 text-xs" })}
            download
            title="Every entry matching the filters below, newest first (up to 20,000)"
          >
            <Download aria-hidden="true" className="size-3.5" />
            Export CSV{filtered ? " (filtered)" : ""}
          </a>
        </div>
        <div className="mb-3">
          <AuditFilters path={PATH} params={params} options={data.options} />
        </div>
        {data.rows.length === 0 ? (
          <EmptyState size="sm">{filtered ? "No audit entries match these filters." : "No audit entries yet."}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left text-xs" aria-label="Audit log entries">
              <thead>
                <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                  {sortHeader("time", "Time")}
                  {sortHeader("actor", "User")}
                  {sortHeader("action", "Action")}
                  {sortHeader("entity", "Record")}
                  <th scope="col" className="py-2 pr-3">Changes</th>
                  <th scope="col" className="py-2">IP</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 align-top last:border-b-0">
                    <td className="py-2 pr-3 whitespace-nowrap text-zinc-700">{formatDateTime(r.createdAt)}</td>
                    <td className="py-2 pr-3">
                      <span className="font-bold">{r.actorName ?? "System"}</span>
                      {r.actorRole ? <span className="block text-[11px] text-zinc-500">{ROLE_LABELS[r.actorRole as Role]}</span> : null}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="block font-semibold">{actionLabel(r.action)}</span>
                      <span className="block font-mono text-[10px] text-zinc-400">{r.action}</span>
                    </td>
                    <td className="max-w-[220px] py-2 pr-3">
                      <RecordCell row={r} />
                    </td>
                    <td className="py-2 pr-3">
                      {r.before == null && r.after == null ? (
                        <span className="text-zinc-400">—</span>
                      ) : (
                        <details>
                          <summary className="cursor-pointer text-[11px] font-bold text-brand">View changes</summary>
                          <div className="mt-2 grid max-w-[420px] gap-2">
                            <Change label="Before" value={r.before} />
                            <Change label="After" value={r.after} />
                          </div>
                        </details>
                      )}
                    </td>
                    <td className="py-2 font-mono text-[11px] whitespace-nowrap text-zinc-600">{r.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.total > 0 ? (
          <div className="mt-3">
            <Pagination page={data.page} pageCount={data.pageCount} total={data.total} params={params} />
          </div>
        ) : null}
      </PanelCard>
    </PageStack>
  );
}
