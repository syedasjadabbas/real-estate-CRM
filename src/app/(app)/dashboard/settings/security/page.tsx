import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { StatusTag } from "@/components/ui/badge";
import { RestrictedState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { SettingsTabs } from "@/features/audit/components/audit-controls";
import { RetentionForm } from "@/features/security/components/retention-form";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime } from "@/features/leads/format";
import { formatInt } from "@/lib/format";
import { canManageSecurity } from "@/modules/security/policy";
import { getRetentionStatus } from "@/modules/security/service";
import { readProxyConfig, resolveClientIp } from "@/server/auth/client-ip";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Security settings" };

const RUN_LABELS: Record<string, string> = {
  completed: "Deleted old entries",
  disabled: "Checked only",
  dry_run: "Dry run",
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold break-words text-zinc-900">{children}</dd>
    </div>
  );
}

/** Admin-only security settings: sign-in log retention and the client IP recording status. */
export default async function SecuritySettingsPage() {
  const actor = await requirePageUser();
  if (!canManageSecurity(actor)) return <RestrictedState />;
  const status = await getRetentionStatus(getDb(), actor);
  const proxy = readProxyConfig();
  const current = resolveClientIp(await headers(), proxy);
  const run = status.lastRun;

  return (
    <PageStack>
      <PageHeader
        title="Security settings"
        description="Sign-in history retention and how client IP addresses are recorded. Super admins and admins only; every change is audited."
        icon={ShieldCheck}
      />
      <SettingsTabs active="security" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Retention" value={`${formatInt(status.retentionMonths)} months`} caption={status.isDefault ? "Proposed default" : "Set by an admin"} />
        <MiniStat label="Automatic deletion" value={status.cleanupEnabled ? "On" : "Off"} caption={status.cleanupEnabled ? "Runs with the daily job" : "Nothing is deleted"} />
        <MiniStat label="Past the cutoff" value={formatInt(status.eligible)} caption={`of ${formatInt(status.total)} sign-in entries`} />
        <MiniStat
          label="Last cleanup run"
          value={<span className="block truncate text-sm leading-[18px]">{run ? (RUN_LABELS[run.status] ?? run.status) : "Never"}</span>}
          caption={run ? `${run.status === "disabled" ? "Deletion off · " : ""}${formatDateTime(run.at)}` : "The job has not run yet"}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <PanelCard title="CRM sign-in history retention" className="min-w-0 self-start">
          <p className="mb-4 text-xs text-zinc-600">
            Applies only to CRM sign-in history (authentication activity). Audit logs, sessions and all other records are never deleted by this
            setting. Entries older than the cutoff ({formatDateTime(status.cutoff)}) are eligible for deletion.
          </p>
          {status.storedValueInvalid ? (
            <p role="alert" className="mb-4 text-xs font-semibold text-rose-600">
              The stored retention value is invalid, so the cleanup job deletes nothing. Save a period between 3 and 120 months.
            </p>
          ) : null}
          <RetentionForm retentionMonths={status.retentionMonths} cleanupEnabled={status.cleanupEnabled} />
          <p className="mt-4 text-[11px] text-zinc-500">
            The cleanup runs once a day on the server (<code>npm run job:prune-signin-logs</code>). Add <code>--dry-run</code> to report without deleting.
            {run ? ` Last run: ${formatInt(run.eligible)} eligible, ${formatInt(run.deleted)} deleted.` : ""}
          </p>
        </PanelCard>

        <PanelCard title="Client IP recording" className="min-w-0 self-start">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Fact label="Trusted proxy">
              {proxy.invalid ? (
                <StatusTag tone="rose">Invalid configuration</StatusTag>
              ) : proxy.trustProxy ? (
                <StatusTag tone="brand">Enabled</StatusTag>
              ) : (
                <StatusTag tone="neutral">Not configured</StatusTag>
              )}
            </Fact>
            <Fact label="IP header">{proxy.trustProxy ? proxy.header : "—"}</Fact>
            <Fact label="Proxies in front">{proxy.trustProxy ? formatInt(proxy.proxyCount) : "—"}</Fact>
            <Fact label="Shared proxy secret">{proxy.sharedSecret ? "Configured" : "Not set"}</Fact>
            <Fact label="Your IP on this request">{current.ip ?? "Not recorded"}</Fact>
            <Fact label="Environment">{proxy.production ? "Production" : "Development"}</Fact>
          </dl>
          <p className="mt-4 text-[11px] text-zinc-500">
            {proxy.invalid
              ? `${proxy.invalid}. No IP addresses are recorded until this is fixed.`
              : proxy.trustProxy
                ? "IP addresses are taken only from the header your reverse proxy overwrites. Values sent by browsers are ignored."
                : proxy.production
                  ? "No IP addresses are recorded: browser-supplied forwarded headers are never trusted. Configure the reverse proxy and set TRUST_PROXY (docs/DEPLOYMENT_PROXY.md)."
                  : "Development: only the local loopback address is recorded."}{" "}
            These settings come from server environment variables and cannot be changed here.
          </p>
        </PanelCard>
      </div>
    </PageStack>
  );
}
