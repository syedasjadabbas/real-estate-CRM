import { DatabaseBackup } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { StatusTag, type Tone } from "@/components/ui/badge";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { SettingsTabs } from "@/features/audit/components/audit-controls";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime } from "@/features/leads/format";
import { formatInt } from "@/lib/format";
import { canViewBackups } from "@/modules/backups/policy";
import { describeRetention, formatAge, formatSize, STALE_AFTER_HOURS } from "@/modules/backups/rules";
import { getBackupOverview, RECENT_RUNS_LIMIT } from "@/modules/backups/service";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Backups" };

const KIND_LABELS: Record<string, string> = {
  backup: "Backup",
  prune: "Retention",
  restore_check: "Restore check",
  restore: "Restore",
};

const STATUS: Record<string, { label: string; tone: Tone }> = {
  succeeded: { label: "Succeeded", tone: "brand" },
  failed: { label: "Failed", tone: "rose" },
  running: { label: "Running", tone: "sky" },
};

/**
 * Settings → Backups (Super Admin only): read-only status of the server's automated backups.
 * There is deliberately no download and no restore button: restores run on the server with
 * scripts/ops/restore.mjs and a Super Admin's approval.
 */
export default async function BackupsSettingsPage() {
  const actor = await requirePageUser();
  if (!canViewBackups(actor)) return <RestrictedState />;
  const data = await getBackupOverview(getDb(), actor);
  const { health, lastBackup, retention } = data;

  return (
    <PageStack>
      <PageHeader
        title="Backups"
        description="Automated nightly backups of the database and uploaded files, retention and restores. Super admins only; read only. Backups and restores are run on the server, never from this page."
        icon={DatabaseBackup}
      />
      <SettingsTabs active="backups" showBackups />

      {health.state !== "ok" ? (
        <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {health.state === "none"
            ? "No successful backup has been recorded. Check that the backup timer is installed and running on the server (scripts/ops/RESTORE.md)."
            : `The last successful backup is ${formatAge(health.ageHours ?? 0)} old (more than ${STALE_AFTER_HOURS} hours). Check the server: journalctl -u mz-crm-backup.service.`}
        </p>
      ) : null}
      {retention.error ? (
        <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {retention.error}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat
          label="Last successful backup"
          value={<span className="block truncate text-sm leading-[18px]">{lastBackup ? `${formatAge(health.ageHours ?? 0)} ago` : "None"}</span>}
          caption={lastBackup ? formatDateTime(lastBackup.finishedAt) : "Nothing recorded yet"}
        />
        <MiniStat label="Last backup size" value={lastBackup ? formatSize(lastBackup.sizeBytes) : "—"} caption={lastBackup?.location ?? "No backup yet"} />
        <MiniStat
          label="Retention"
          value={<span className="block truncate text-sm leading-[18px]">{retention.error ? "Invalid" : describeRetention(retention)}</span>}
          caption={retention.error ? "Fix the server setting" : retention.isDefault ? "Default (server setting)" : "Server setting"}
        />
        <MiniStat label="Failed runs (7 days)" value={formatInt(data.failuresLast7Days)} caption={data.offServerCopy ? "Off-server copy configured" : "No off-server copy configured"} />
      </div>

      <PanelCard title={`Recent runs · last ${RECENT_RUNS_LIMIT}`} className="min-w-0">
        {data.runs.length === 0 ? (
          <EmptyState size="sm">No backup, retention or restore runs have been recorded yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left text-xs" aria-label="Backup runs">
              <thead>
                <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                  <th scope="col" className="py-2 pr-3">
                    Started
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Kind
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Status
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Backup
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Size
                  </th>
                  <th scope="col" className="py-2">
                    Message
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map((r) => {
                  const status = STATUS[r.status] ?? { label: r.status, tone: "neutral" as Tone };
                  return (
                    <tr key={r.id} className="border-b border-zinc-100 align-top last:border-b-0">
                      <td className="py-2 pr-3 whitespace-nowrap text-zinc-700">
                        {formatDateTime(r.startedAt)}
                        <span className="block text-[11px] text-zinc-500">
                          {r.trigger}
                          {r.actorName ? ` · ${r.actorName}` : ""}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-semibold whitespace-nowrap">{KIND_LABELS[r.kind] ?? r.kind}</td>
                      <td className="py-2 pr-3">
                        <StatusTag tone={status.tone}>{status.label}</StatusTag>
                      </td>
                      <td className="py-2 pr-3 font-mono text-[11px] whitespace-nowrap text-zinc-600">{r.location ?? "—"}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-zinc-700">{formatSize(r.sizeBytes)}</td>
                      <td className="max-w-[420px] py-2 break-words text-zinc-700">{r.message ?? (r.status === "running" ? "In progress" : "—")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-[11px] text-zinc-500">
          Backups run every night on the server (<code>mz-crm-backup.timer</code>) and are checked against their checksums. Retention removes only old
          backup folders on the server; the newest good backup is always kept. Restores need a Super Admin&apos;s approval on the server, take a fresh
          backup first and are recorded here and in the audit log. Backup contents are never shown or downloaded here.
        </p>
      </PanelCard>
    </PageStack>
  );
}
