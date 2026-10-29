import { ROLE_LABELS } from "@/server/auth/types";
import { apiRoute } from "@/server/http";

/** GET /api/v1/auth/me — the signed-in user (no secrets). */
export const GET = apiRoute(async ({ actor }) => ({ ...actor, roleLabel: ROLE_LABELS[actor.role] }));
