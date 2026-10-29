import { clientScope } from "@/modules/clients/policy";
import type { Actor } from "@/server/auth/types";

/** Amber scope notice, worded for clients (same style as Leads). */
export function ClientsScopeNotice({ actor }: { actor: Actor }) {
  const scope = clientScope(actor.role);
  if (scope === "all") return null;
  return (
    <div className="rounded-2xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 shadow-hairline">
      <span className="font-semibold">{scope === "own" ? "Your clients only." : "Your teams' clients only."}</span>{" "}
      {scope === "own"
        ? "This list is limited to clients assigned to you."
        : "This list is limited to clients owned by you and the members of the teams you manage."}
    </div>
  );
}
