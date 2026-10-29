import "server-only";
import { canDoClient } from "@/modules/clients/policy";
import { requirePageUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";

/** Everything a Clients page needs: the verified user and DB handle (clients span projects). */
export async function clientsContext() {
  const actor = await requirePageUser();
  return { actor, db: getDb(), canView: canDoClient(actor, "view") };
}
