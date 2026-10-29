import "server-only";
import { canDo } from "@/modules/leads/policy";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { getProjectScope } from "@/server/project-scope";

/** Everything a Leads page needs: the verified user, DB handle and selected project. */
export async function leadsContext() {
  const actor = await requirePageUser();
  const { projects, activeProjectId } = await getProjectScope();
  return {
    actor,
    db: getDb(),
    projectId: activeProjectId,
    projectName: projects.find((p) => p.id === activeProjectId)?.name ?? null,
    canView: canDo(actor, "view"),
  };
}
