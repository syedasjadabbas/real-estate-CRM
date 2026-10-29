import { setFavorite } from "@/modules/leads/commands";
import { apiRoute } from "@/server/http";

export const POST = apiRoute(async ({ db, actor, params }) => setFavorite(db, actor, params.id, true));
export const DELETE = apiRoute(async ({ db, actor, params }) => setFavorite(db, actor, params.id, false));
