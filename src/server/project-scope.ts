import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { activeProjectFor } from "@/modules/projects/queries";
import { getCurrentUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

/** The old cookie shared by everyone on a browser. Never read; removed at sign-out. */
export const SHARED_PROJECT_COOKIE = "mz_project";

/** Projects offered in the header (admins also get inactive ones) plus this person's selected one. Callers have already resolved the session. */
export const getProjectScope = cache(async () => {
  const jar = await cookies();
  return activeProjectFor(getDb(), await getCurrentUser(), (name) => jar.get(name)?.value);
});
