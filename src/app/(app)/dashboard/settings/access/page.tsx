import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader, PageStack } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState, RestrictedState } from "@/components/ui/empty-state";
import { AccessToggle } from "@/features/hr/components/access-toggle";
import { formatDateTime } from "@/features/leads/format";
import { formatInt } from "@/lib/format";
import { canManageAccess, listAccess, type AccessRow } from "@/modules/accounts/access";
import { requirePageUser } from "@/server/auth/current-user";
import { ROLE_LABELS, type Role } from "@/server/auth/types";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Users & access" };

const GROUPS: { title: string; roles: Role[] }[] = [
  { title: "Super Admins", roles: ["super_admin"] },
  { title: "Admins", roles: ["admin", "manager"] },
  { title: "Agents", roles: ["agent"] },
  { title: "HR and Accounts", roles: ["hr", "accountant"] },
];

function Row({ r, superAdminsOn }: { r: AccessRow; superAdminsOn: number }) {
  const lastSuper = r.role === "super_admin" && r.status === "active" && superAdminsOn <= 1;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-bold">
          {r.name}
          {r.self ? <span className="ml-1.5 text-[11px] font-semibold text-zinc-500">(you)</span> : null}
        </p>
        <p className="text-[11px] break-words text-zinc-500">
          {r.email} · {ROLE_LABELS[r.role]}
          {r.teams.length ? ` · ${r.teams.join(", ")}` : ""}
        </p>
        <p className="text-[11px] text-zinc-500">
          Last sign-in {r.lastSignInAt ? formatDateTime(r.lastSignInAt) : "never"}
          {r.openLeads ? ` · ${formatInt(r.openLeads)} open ${r.openLeads === 1 ? "lead" : "leads"}` : ""}
        </p>
      </div>
      <AccessToggle
        userId={r.id}
        name={r.name}
        active={r.status === "active"}
        disabled={r.self || lastSuper}
        disabledReason={r.self ? "You can't turn off your own access" : "The last active Super Admin can't be turned off"}
      />
    </li>
  );
}

/** Super Admin only: every account with one access switch (owner, 14 Nov 2026). */
export default async function AccessPage() {
  const actor = await requirePageUser();
  if (!canManageAccess(actor)) return <RestrictedState />;
  const rows = await listAccess(getDb(), actor);
  const superAdminsOn = rows.filter((r) => r.role === "super_admin" && r.status === "active").length;
  const off = rows.filter((r) => r.status !== "active").length;

  return (
    <PageStack>
      <PageHeader
        title="Users & access"
        description={`Everyone with a CRM account. Switch on = full access for their role; off = no access, signed out at once.${off ? ` ${formatInt(off)} switched off.` : ""}`}
        icon={ShieldCheck}
      />
      <p className="text-[11px] text-zinc-500">
        Turning someone off doesn&apos;t move their leads: they stay with that person until an Admin reassigns them (HR → Employees → Shift leads). Every change is
        recorded in the audit log.
      </p>
      {rows.length === 0 ? (
        <EmptyState>No accounts yet.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {GROUPS.map((g) => {
            const list = rows.filter((r) => g.roles.includes(r.role));
            if (list.length === 0) return null;
            return (
              <Card key={g.title} className="self-start p-4">
                <p className="mb-3 text-[10px] font-black tracking-[0.2em] text-brand uppercase">
                  {g.title} · {list.filter((r) => r.status === "active").length} of {list.length} on
                </p>
                <ul className="divide-y divide-zinc-100">
                  {list.map((r) => (
                    <Row key={r.id} r={r} superAdminsOn={superAdminsOn} />
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </PageStack>
  );
}
