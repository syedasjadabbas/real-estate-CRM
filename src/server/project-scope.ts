import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { selectableProjects } from "@/modules/projects/queries";
import { getCurrentUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

export const PROJECT_COOKIE = "mz_project";

/**
 * Projects offered in the header (admins also get inactive ones) plus the selected one
 * (cookie, falling back to the first). Callers have already resolved the session.
 */
export const getProjectScope = cache(async () => {
  const projects = await selectableProjects(getDb(), await getCurrentUser());
  const chosen = (await cookies()).get(PROJECT_COOKIE)?.value;
  const active = projects.find((p) => p.id === chosen) ?? projects[0] ?? null;
  return { projects, activeProjectId: active?.id ?? null };
});
