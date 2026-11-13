import { pendingVerification } from "@/modules/leads/verification";
import { apiRoute, resolveProjectId } from "@/server/http";

/** GET: leads waiting for verification in the project, oldest first (Admin and Super Admin). */
export const GET = apiRoute(async ({ req, db, actor }) => pendingVerification(db, actor, await resolveProjectId(req, db)));
