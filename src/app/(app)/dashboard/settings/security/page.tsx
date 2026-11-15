import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { StatusTag } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { MiniStat } from "@/components/ui/stat";
import { SettingsTabs } from "@/features/audit/components/audit-controls";
import { RetentionForm } from "@/features/security/components/retention-form";
import { PanelCard } from "@/features/leads/components/detail-panels";
import { formatDateTime } from "@/features/leads/format";
import { flattenParams, withParams } from "@/features/leads/url";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { canViewBackups } from "@/modules/backups/policy";
import { canManageSecurity } from "@/modules/security/policy";
import { getRetentionStatus } from "@/modules/security/service";
import { listSignins } from "@/modules/security/signins";
import { readProxyConfig, resolveClientIp } from "@/server/auth/client-ip";
import { requirePageUser } from "@/server/auth/current-user";
import { ROLE_LABELS, type Role } from "@/server/auth/types";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Security settings" };

const PATH = "/dashboard/settings/security";
const RUN_LABELS: Record<string, string> = {
  completed: "Deleted old entries",
  disabled: "Counted only",
  dry_run: "Counted only",
};
const field = "h-9 rounded-xl border border-zinc-200/80 bg-white px-3 text-xs font-semibold shadow-hairline focus:border-brand/50 focus:outline-none";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold break-words text-zinc-900">{children}</dd>
    </div>
  );
}

/** Admin-only security settings: sign-in history (list and retention) and how IP addresses are recorded. */
export default async function SecuritySettingsPage({ searchParams }: PageProps<"/dashboard/settings/security">) {
  const actor = await requirePageUser();
  if (!canManageSecurity(actor)) return <RestrictedState />;
  const params = flattenParams(await searchParams);
  const db = getDb();
  const status = await getRetentionStatus(db, actor);
  const signins = await listSignins(db, actor, params);
  const proxy = readProxyConfig();
  const current = resolveClientIp(await headers(), proxy);
  const run = status.lastRun;
  const runStale = status.lastRunStale;
  const ipState: "ok" | "local" | "off" | "broken" = proxy.invalid ? "broken" : proxy.trustProxy ? "ok" : proxy.production ? "off" : "local";
  const filtered = Boolean(params.sq || params.sevent || params.sfrom || params.sto);

  return (
    <PageStack>
      <PageHeader
        title="Security settings"
        description="Who signs in to the CRM, how long that history is kept, and whether computer addresses (IP) are being recorded. Only Admins and Super Admins can see this page; every change is in the audit log."
        icon={ShieldCheck}
      />
      <SettingsTabs active="security" showBackups={canViewBackups(actor)} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Keep sign-in history" value={`${formatInt(status.retentionMonths)} months`} caption={status.isDefault ? "Agreed default" : "Set by an Admin"} />
        <MiniStat label="Automatic deletion" value={status.cleanupEnabled ? "On" : "Off"} caption={status.cleanupEnabled ? "Older history is deleted daily" : "Nothing is deleted"} />
        <MiniStat label="Older than the period" value={formatInt(status.eligible)} caption={`of ${formatInt(status.total)} sign-in entries`} />
        <MiniStat
          label="Last cleanup check"
          value={<span className={cn("block truncate text-sm leading-[18px]", runStale && "text-amber-700")}>{run ? (RUN_LABELS[run.status] ?? run.status) : "Never run"}</span>}
          caption={run ? formatDateTime(run.at) : "Not run yet"}
        />
      </div>

      {runStale ? (
        <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
          {run ? `The daily cleanup check hasn't run since ${formatDateTime(run.at)}.` : "The daily cleanup check has never run."}{" "}
          {proxy.production
            ? "It should run every day on the server. Ask whoever manages the server to check the scheduled job."
            : "That's expected on your own computer; on the live server it runs every day."}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <PanelCard title="How long to keep sign-in history" className="min-w-0 self-start">
          <p className="mb-4 text-xs text-zinc-600">
            This only covers the record of people signing in and out. The audit log, leads, bookings and everything else are never deleted by it. Today,
            entries from before {formatDateTime(status.cutoff)} are older than the period.
          </p>
          {status.storedValueInvalid ? (
            <p role="alert" className="mb-4 text-xs font-semibold text-rose-600">
              The saved period is not valid, so nothing is being deleted. Save a period between 3 and 120 months.
            </p>
          ) : null}
          <RetentionForm retentionMonths={status.retentionMonths} cleanupEnabled={status.cleanupEnabled} />
          {run ? (
            <p className="mt-4 text-[11px] text-zinc-500">
              Last check, {formatDateTime(run.at)}: {formatInt(run.eligible)} entries were older than the period, {formatInt(run.deleted)} deleted.
            </p>
          ) : null}
        </PanelCard>

        <PanelCard title="Computer addresses (IP)" className="min-w-0 self-start">
          <p
            className={cn(
              "mb-4 rounded-xl px-3 py-2 text-xs font-semibold",
              ipState === "ok" && "bg-brand-50 text-brand-700",
              ipState === "local" && "bg-zinc-50 text-zinc-700",
              (ipState === "off" || ipState === "broken") && "bg-rose-50 text-rose-700",
            )}
          >
            {ipState === "ok"
              ? "Recording each person's real IP address in the audit log and sign-in history."
              : ipState === "local"
                ? "You're running the CRM on your own computer, so every action shows ::1 (this computer). On the live site, real addresses are recorded once the server is set up for it."
                : ipState === "off"
                  ? "IP addresses are NOT being recorded: the audit log and sign-in history show “—” instead of an address. Ask whoever manages the server to set up the trusted proxy."
                  : `IP recording is switched off because the server setup has a mistake (${proxy.invalid}). Ask whoever manages the server to fix it.`}
          </p>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Fact label="Your address right now">{current.ip ?? "Not recorded"}</Fact>
            <Fact label="Running on">{proxy.production ? "Live server" : "This computer (development)"}</Fact>
          </dl>
          <details className="mt-4 text-[11px] text-zinc-500">
            <summary className="cursor-pointer font-bold text-zinc-600">Technical details, for whoever manages the server</summary>
            <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Fact label="Trusted proxy">
                {proxy.invalid ? <StatusTag tone="rose">Invalid</StatusTag> : proxy.trustProxy ? <StatusTag tone="brand">Enabled</StatusTag> : <StatusTag tone="neutral">Not configured</StatusTag>}
              </Fact>
              <Fact label="IP header">{proxy.trustProxy ? proxy.header : "—"}</Fact>
              <Fact label="Proxies in front">{proxy.trustProxy ? formatInt(proxy.proxyCount) : "—"}</Fact>
              <Fact label="Shared proxy secret">{proxy.sharedSecret ? "Configured" : "Not set"}</Fact>
            </dl>
            <p className="mt-3">
              Set with the TRUST_PROXY server settings (see docs/DEPLOYMENT_PROXY.md). The daily cleanup is the job:prune-signin-logs script. These can&apos;t be
              changed from this page.
            </p>
          </details>
        </PanelCard>
      </div>

      <PanelCard title={`Sign-in history · ${formatInt(signins.total)}`} className="min-w-0">
        <p className="mb-3 text-xs text-zinc-600">
          Every time someone signs in to or out of the CRM, newest first. Use it to see when someone last logged in, or to spot sign-ins at odd hours or from
          an unknown address. It isn&apos;t attendance: check-ins are in HR → Attendance.
        </p>
        <form method="get" action={PATH} role="search" aria-label="Filter sign-in history" className="mb-3 flex flex-wrap items-end gap-2">
          <input type="search" name="sq" defaultValue={params.sq ?? ""} placeholder="Name, email or IP" maxLength={100} autoComplete="off" aria-label="Name, email or IP" className={cn(field, "min-w-0 flex-1 basis-48 sm:max-w-xs")} />
          <select name="sevent" defaultValue={params.sevent ?? ""} aria-label="Sign-in or sign-out" className={field}>
            <option value="">Sign-ins and sign-outs</option>
            <option value="sign_in">Sign-ins only</option>
            <option value="sign_out">Sign-outs only</option>
          </select>
          <span className="flex items-center gap-1.5 text-xs font-bold text-zinc-500">
            From
            <input type="date" name="sfrom" defaultValue={params.sfrom ?? ""} aria-label="From" className={field} />
            to
            <input type="date" name="sto" defaultValue={params.sto ?? ""} aria-label="To" className={field} />
          </span>
          <button type="submit" className={buttonClasses({ variant: "primary", size: "md" })}>
            Filter
          </button>
          {filtered ? (
            <Link href={PATH} className={buttonClasses({ variant: "secondary", size: "md" })}>
              Clear
            </Link>
          ) : null}
        </form>
        {signins.rows.length === 0 ? (
          <EmptyState size="sm">{filtered ? "No sign-ins match these filters." : "No sign-ins recorded yet."}</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200/80">
            <table className="w-full min-w-max border-collapse text-left text-xs" aria-label="Sign-in history">
              <thead className="bg-zinc-100">
                <tr className="border-b border-zinc-200 text-[10px] font-black tracking-[0.05em] text-zinc-600 uppercase">
                  <th scope="col" className="px-3 py-2.5">Time</th>
                  <th scope="col" className="px-3 py-2.5">Person</th>
                  <th scope="col" className="px-3 py-2.5">Event</th>
                  <th scope="col" className="px-3 py-2.5">Browser</th>
                  <th scope="col" className="px-3 py-2.5">IP</th>
                </tr>
              </thead>
              <tbody>
                {signins.rows.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100/80 last:border-b-0">
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-700">{formatDateTime(r.at)}</td>
                    <td className="px-3 py-2">
                      <Link href={withParams(PATH, params, { sq: r.email, spage: null })} className="font-bold hover:text-brand hover:underline" title="Show only this person">
                        {r.name}
                      </Link>
                      <span className="block text-[11px] text-zinc-500">{ROLE_LABELS[r.role as Role] ?? r.role}</span>
                    </td>
                    <td className="px-3 py-2">
                      <StatusTag tone={r.event === "sign_in" ? "brand" : "neutral"}>{r.event === "sign_in" ? "Signed in" : "Signed out"}</StatusTag>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-700" title={r.agent ?? undefined}>
                      {r.device}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] whitespace-nowrap text-zinc-600">{r.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {signins.pageCount > 1 ? (
          <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-500">
            <span>
              Page {signins.page} of {signins.pageCount}
            </span>
            <span className="flex gap-2">
              {signins.page > 1 ? (
                <Link href={withParams(PATH, params, { spage: String(signins.page - 1) })} className={buttonClasses({ variant: "secondary", size: "md" })}>
                  Previous
                </Link>
              ) : null}
              {signins.page < signins.pageCount ? (
                <Link href={withParams(PATH, params, { spage: String(signins.page + 1) })} className={buttonClasses({ variant: "secondary", size: "md" })}>
                  Next
                </Link>
              ) : null}
            </span>
          </div>
        ) : null}
      </PanelCard>
    </PageStack>
  );
}
