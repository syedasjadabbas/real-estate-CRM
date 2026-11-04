import { ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { AuditFilters, AuditSortHeader, SettingsTabs } from "@/features/audit/components/audit-controls";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { Pagination } from "@/features/leads/components/pagination";
import { formatDateTime } from "@/features/leads/format";
import { flattenParams } from "@/features/leads/url";
import { canViewAuditLog, listAuditLogs, type AuditRow, type AuditSortColumn } from "@/modules/audit/service";
import { requirePageUser } from "@/server/auth/current-user";
import { ROLE_LABELS, type Role } from "@/server/auth/types";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Audit log" };

const PATH = "/dashboard/settings/audit-log";
/** Record pages that exist for an audited entity; other entities show their id only. */
const RECORD_LINKS: Record<string, (id: string) => string> = {
  lead: (id) => `/dashboard/leads/${id}`,
  client: (id) => `/dashboard/clients/${id}`,
};

function Change({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-black tracking-[0.05em] text-zinc-500 uppercase">{label}</p>
      <pre className="mt-0.5 max-h-60 overflow-auto rounded-lg bg-zinc-50 p-2 text-[11px] leading-4 break-words whitespace-pre-wrap text-zinc-800">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

function RecordCell({ row }: { row: AuditRow }) {
  const link = row.entityId && RECORD_LINKS[row.entity] && /^[0-9a-f-]{36}$/i.test(row.entityId) ? RECORD_LINKS[row.entity](row.entityId) : null;
  return (
    <>
      <span className="font-semibold">{row.entity}</span>
      {row.entityId ? (
        link ? (
          <Link href={link} className="block truncate font-mono text-[11px] text-brand hover:underline">
            {row.entityId}
          </Link>
        ) : (
          <span className="block truncate font-mono text-[11px] text-zinc-500">{row.entityId}</span>
        )
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
        description="Who changed what, and when. Read-only: entries can't be edited or deleted. Times are Pakistan time; IP addresses appear only when a trusted proxy supplies them."
        icon={ScrollText}
      />
      <SettingsTabs active="audit" />
      <PanelCard title={`Entries · ${data.total}`}>
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
                    <td className="py-2 pr-3 font-mono text-[11px] font-semibold">{r.action}</td>
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
