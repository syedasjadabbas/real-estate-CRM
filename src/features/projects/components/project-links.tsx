"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setActiveProjectAction } from "@/features/auth/actions";
import { formatInt } from "@/lib/format";

/**
 * Leads and clients linked to the project, counted within the viewer's own scope.
 * "Open leads" switches the header project first, because Leads is scoped to the selected project.
 */
export function ProjectLinks({
  projectId,
  leads,
  clients,
  canOpenLeads,
}: {
  projectId: string;
  leads: number | null;
  clients: number | null;
  /** False when the project can't be selected (inactive, for non-admins). */
  canOpenLeads: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const openLeads = () =>
    startTransition(async () => {
      const result = await setActiveProjectAction(projectId);
      if (result.ok) router.push("/dashboard/leads");
      else setError(result.message);
    });

  const row = "flex items-center justify-between gap-3 rounded-xl border border-zinc-200/80 px-3 py-2.5 shadow-hairline";
  const label = "text-[10px] font-black tracking-[0.1em] text-zinc-500 uppercase";
  const action = "inline-flex items-center gap-1 text-xs font-bold text-brand hover:underline disabled:opacity-50";

  return (
    <div className="space-y-2">
      {leads !== null ? (
        <div className={row}>
          <div>
            <p className={label}>Leads in your scope</p>
            <p className="text-lg leading-6 font-black tabular-nums">{formatInt(leads)}</p>
          </div>
          {canOpenLeads ? (
            <button type="button" onClick={openLeads} disabled={pending} className={action}>
              Open leads <ArrowRight aria-hidden="true" className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
      {clients !== null ? (
        <div className={row}>
          <div>
            <p className={label}>Clients with a lead here</p>
            <p className="text-lg leading-6 font-black tabular-nums">{formatInt(clients)}</p>
          </div>
          <Link href="/dashboard/clients" className={action}>
            Clients <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </div>
      ) : null}
      {leads === null && clients === null ? <p className="text-xs text-zinc-600">Your role has no access to leads or clients.</p> : null}
      {error ? (
        <p role="alert" className="text-xs font-semibold text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
