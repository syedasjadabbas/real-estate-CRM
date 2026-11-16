import { UserX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { SettingsTabs } from "@/features/audit/components/audit-controls";
import { ReactivateButton } from "@/features/hr/components/reactivate-button";
import { formatDateTime } from "@/features/leads/format";
import { formatInt } from "@/lib/format";
import { listDeactivated } from "@/modules/accounts/deactivated";
import { canManageAccounts } from "@/modules/accounts/policy";
import { canViewBackups } from "@/modules/backups/policy";
import { requirePageUser } from "@/server/auth/current-user";
import { ROLE_LABELS, type Role } from "@/server/auth/types";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Deactivated accounts" };

const inputClass =
  "h-10 rounded-xl border border-zinc-200/80 bg-white px-3 text-xs font-semibold shadow-hairline focus:border-brand/50 focus:outline-none";

/**
 * Deactivated accounts (owner, 16 Nov 2026): Admins and Super Admins see every switched-off account
 * they may manage, when and by whom it was switched off, and turn it back on. Filters: name or email,
 * role, and "switched off by me".
 */
export default async function DeactivatedAccountsPage({ searchParams }: PageProps<"/dashboard/settings/deactivated">) {
  const actor = await requirePageUser();
  if (!canManageAccounts(actor)) return <RestrictedState />;
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(params.q).trim().toLowerCase();
  const role = one(params.role);
  const mine = one(params.by) === "me";

  const all = await listDeactivated(getDb(), actor);
  const rows = all.filter(
    (r) => (!q || `${r.name} ${r.email}`.toLowerCase().includes(q)) && (!role || r.role === role || (role === "admin" && r.role === "manager")) && (!mine || r.deactivatedById === actor.id),
  );
  const roles = [...new Set(all.map((r) => (r.role === "manager" ? "admin" : r.role)))] as Role[];
  const filtered = Boolean(q || role || mine);

  return (
    <PageStack>
      <PageHeader
        title="Deactivated accounts"
        description="Everyone whose CRM access is switched off. They can't sign in until someone reactivates them. Reactivating keeps their password, role and teams, and is recorded in the audit log."
        icon={UserX}
      />
      <SettingsTabs active="deactivated" showBackups={canViewBackups(actor)} />

      <form method="get" className="flex flex-wrap items-center gap-2">
        <input type="search" name="q" defaultValue={one(params.q)} placeholder="Search name or email" aria-label="Search deactivated accounts" className={`${inputClass} w-full max-w-xs`} />
        <select name="role" defaultValue={role} aria-label="Role" className={inputClass}>
          <option value="">All roles</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700">
          <input type="checkbox" name="by" value="me" defaultChecked={mine} className="size-4 accent-[var(--color-brand)]" />
          Switched off by me
        </label>
        <button type="submit" className="h-10 rounded-xl bg-brand px-4 text-xs font-bold text-white">
          Filter
        </button>
        {filtered ? (
          <Link href="/dashboard/settings/deactivated" className="text-xs font-semibold text-zinc-500 hover:text-zinc-800 hover:underline">
            Clear
          </Link>
        ) : null}
        <span className="ml-auto text-xs text-zinc-500">
          {filtered ? `${formatInt(rows.length)} of ${formatInt(all.length)}` : formatInt(all.length)} deactivated
        </span>
      </form>

      {all.length === 0 ? (
        <EmptyState>No deactivated accounts. Everyone with a CRM account can sign in.</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>No deactivated account matches these filters.</EmptyState>
      ) : (
        <Card className="p-4">
          <ul className="divide-y divide-zinc-100">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-sm font-bold">{r.name}</p>
                  <p className="text-[11px] break-words text-zinc-500">
                    {r.email} · {ROLE_LABELS[r.role]}
                    {r.teams.length ? ` · ${r.teams.join(", ")}` : ""}
                  </p>
                  <p className="text-[11px] text-zinc-600">
                    {r.deactivatedAt ? (
                      <>
                        Switched off {formatDateTime(r.deactivatedAt)}
                        {r.deactivatedByName ? ` by ${r.deactivatedById === actor.id ? "you" : r.deactivatedByName}` : ""}
                      </>
                    ) : (
                      "Switched off (date not recorded)"
                    )}
                    {` · last sign-in ${r.lastSignInAt ? formatDateTime(r.lastSignInAt) : "never"}`}
                  </p>
                  {r.openLeads ? (
                    <p className="text-[11px] font-semibold text-amber-700">
                      Still owns {formatInt(r.openLeads)} open {r.openLeads === 1 ? "lead" : "leads"}: move them in HR → Employees → Shift leads, or reactivate.
                    </p>
                  ) : null}
                </div>
                <ReactivateButton userId={r.id} name={r.name} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="text-[11px] text-zinc-500">
        {actor.role === "super_admin" ? "You see every role." : "Super Admin accounts are managed by a Super Admin and aren't listed here."} The full history of who
        switched accounts on and off is in the Audit log.
      </p>
    </PageStack>
  );
}
