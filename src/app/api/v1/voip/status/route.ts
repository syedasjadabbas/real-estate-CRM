import { getVoipStatus } from "@/modules/voip/service";
import { apiRoute } from "@/server/http";

/** GET — whether browser calling is set up: { configured, provider, providerName, reason? }. Never secrets. Lead roles only. */
export const GET = apiRoute(async ({ actor }) => getVoipStatus(actor));
