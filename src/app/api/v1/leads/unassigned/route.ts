import { listUnassigned } from "@/modules/leads/claims";
import { apiRoute } from "@/server/http";
import { getProjectScope } from "@/server/project-scope";

/** GET — unassigned leads in the selected project (no phone numbers). Agents, managers and admins. */
export const GET = apiRoute(async ({ db, actor }) => listUnassigned(db, actor, (await getProjectScope()).activeProjectId));
