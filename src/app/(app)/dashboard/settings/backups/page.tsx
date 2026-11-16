import { DatabaseBackup } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { StatusTag, type Tone } from "@/components/ui/badge";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { SettingsTabs } from "@/features/audit/components/audit-controls";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime } from "@/features/leads/format";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { canViewBackups } from "@/modules/backups/policy";
import { describeRetention, describeRetentionPlain, formatAge, formatSize, plainRunSummary, RUN_TRIGGER_LABELS, STALE_AFTER_HOURS } from "@/modules/backups/rules";
import { getBackupOverview, RECENT_RUNS_LIMIT } from "@/modules/backups/service";
import { readProxyConfig } from "@/server/auth/client-ip";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Backups" };

const KIND_LABELS: Record<string, string> = {
  backup: "Backup",
  prune: "Tidy-up",
  restore_check: "Test restore",
  restore: "Restore",
};

const STATUS: Record<string, { label: string; tone: Tone }> = {
  succeeded: { label: "Worked", tone: "brand" },
  failed: { label: "Failed", tone: "rose" },
  running: { label: "Running", tone: "sky" },
};

/**
 * Settings → Backups (Super Admin only): read-only status of the server's automated backups, in plain
 * words (owner review, 16 Nov 2026). There is deliberately no download and no restore button:
 * restores run on the server with scripts/ops/restore.mjs and a Super Admin's approval.
 */
export default async function BackupsSettingsPage() {
  const actor = await requirePageUser();
  if (!canViewBackups(actor)) return <RestrictedState />;
  const data = await getBackupOverview(getDb(), actor);
  const { health, lastBackup, retention } = data;
  const live = readProxyConfig().production;

  return (
    <PageStack>
      <PageHeader
        title="Backups"
        description="Every night the server saves a copy of all CRM data and uploaded files, so nothing is lost if something goes wrong. This page shows whether that's working. Only Super Admins see it, and nothing can be changed or downloaded here."
        icon={DatabaseBackup}
      />
      <SettingsTabs active="backups" showBackups />

      {health.state !== "ok" ? (
        <div role="alert" className={cn("rounded-2xl border px-4 py-3 text-sm", live ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-800")}>
          <p className="font-bold">
            {health.state === "none" ? "No backup has been saved yet." : `The last backup was ${formatAge(health.ageHours ?? 0)} ago. It should happen every night.`}
          </p>
          <p className="mt-1 text-xs font-medium">
            {live
              ? "Ask whoever manages the server to check the nightly backup today. Until it works, recent changes could be lost if the server fails."
              : "That's expected on your own computer, where the nightly backup isn't running. On the live server this warning means backups have stopped."}
          </p>
          <details className="mt-2 text-[11px] font-medium opacity-80">
            <summary className="cursor-pointer">Technical details</summary>
            <p className="mt-1">
              {health.state === "none"
                ? "No successful backup run is recorded. Check that the backup timer is installed and running (scripts/ops/RESTORE.md)."
                : `Last success is more than ${STALE_AFTER_HOURS} hours old. Check the server log: journalctl -u mz-crm-backup.service.`}
            </p>
          </details>
        </div>
      ) : null}
      {retention.error ? (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <p className="font-bold">How long backups are kept is set up wrongly on the server, so old backups aren&apos;t being tidied up.</p>
          <details className="mt-2 text-[11px] font-medium opacity-80">
            <summary className="cursor-pointer">Technical details</summary>
            <p className="mt-1">{retention.error}</p>
          </details>
        </div>
      ) : null}
      {!data.offServerCopy ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-bold">Backups are kept on the same server as the CRM only.</p>
          <p className="mt-1 text-xs font-medium">
            If that server is lost or damaged, its backups go with it. Ask whoever manages the server to also send a copy somewhere else (another server or cloud
            storage).
          </p>
          <details className="mt-2 text-[11px] font-medium opacity-80">
            <summary className="cursor-pointer">Technical details</summary>
            <p className="mt-1">Set BACKUP_REMOTE on the server to enable the off-server copy.</p>
          </details>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat
          label="Last good backup"
          value={<span className={cn("block truncate text-sm leading-[18px]", health.state !== "ok" && "text-rose-700")}>{lastBackup ? `${formatAge(health.ageHours ?? 0)} ago` : "None yet"}</span>}
          caption={lastBackup ? formatDateTime(lastBackup.finishedAt) : "Nothing saved yet"}
        />
        <MiniStat label="Size of last backup" value={lastBackup ? formatSize(lastBackup.sizeBytes) : "—"} caption="Data and uploaded files" />
        <MiniStat
          label="How long backups are kept"
          value={<span className="block truncate text-sm leading-[18px]">{retention.error ? "Set up wrongly" : describeRetention(retention)}</span>}
          caption={retention.error ? "See the warning above" : describeRetentionPlain(retention)}
        />
        <MiniStat
          label="Off-site copy"
          value={<span className={cn("block truncate text-sm leading-[18px]", !data.offServerCopy && "text-amber-700")}>{data.offServerCopy ? "On" : "Not set up"}</span>}
          caption={`${formatInt(data.failuresLast7Days)} failed run${data.failuresLast7Days === 1 ? "" : "s"} in the last 7 days`}
        />
      </div>

      <PanelCard title={`Recent activity · last ${RECENT_RUNS_LIMIT}`} className="min-w-0">
        {data.runs.length === 0 ? (
          <EmptyState size="sm">Nothing has run yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-xs" aria-label="Backup activity">
              <thead>
                <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                  <th scope="col" className="py-2 pr-3">When</th>
                  <th scope="col" className="py-2 pr-3">What</th>
                  <th scope="col" className="py-2 pr-3">Result</th>
                  <th scope="col" className="py-2 pr-3">Size</th>
                  <th scope="col" className="py-2">What happened</th>
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
                          {RUN_TRIGGER_LABELS[r.trigger] ?? r.trigger}
                          {r.actorName ? ` · ${r.actorName}` : ""}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-semibold whitespace-nowrap">{KIND_LABELS[r.kind] ?? r.kind}</td>
                      <td className="py-2 pr-3">
                        <StatusTag tone={status.tone}>{status.label}</StatusTag>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-zinc-700">{formatSize(r.sizeBytes)}</td>
                      <td className="max-w-[460px] py-2 break-words text-zinc-800">
                        {plainRunSummary(r)}
                        {r.message || r.location ? (
                          <details className="mt-0.5 text-[11px] text-zinc-500">
                            <summary className="cursor-pointer font-semibold">Details</summary>
                            {r.location ? <p className="mt-1 font-mono">Backup: {r.location}</p> : null}
                            {r.message ? <p className="mt-1">{r.message}</p> : null}
                          </details>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 space-y-1 text-[11px] text-zinc-500">
          <p>
            <strong>Backup</strong>: a copy of everything, checked after saving to make sure it isn&apos;t damaged. <strong>Tidy-up</strong>: old backups are
            removed to save space; the newest good one is always kept. <strong>Test restore</strong>: a backup is brought back on the side to prove it works.
          </p>
          <p>
            To bring data back from a backup, ask whoever manages the server. A restore needs a Super Admin&apos;s approval, a fresh backup is taken first, and it
            shows here and in the audit log.
          </p>
        </div>
      </PanelCard>
    </PageStack>
  );
}
