import { and, asc, eq } from "drizzle-orm";
import type { Database } from "@/server/db";
import { followUps } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { completeFollowUp } from "./commands";
import { assertCan } from "./policy";
import { loadAccessibleLead } from "./support";

/** "DONE" in the leads table: completes the lead's earliest pending follow-up. */
export async function completeNextFollowUp(db: Database, actor: Actor, leadId: string) {
  assertCan(actor, "edit");
  await loadAccessibleLead(db, actor, leadId);
  const [next] = await db
    .select({ id: followUps.id })
    .from(followUps)
    .where(and(eq(followUps.leadId, leadId), eq(followUps.status, "pending")))
    .orderBy(asc(followUps.dueAt))
    .limit(1);
  if (!next) throw new AppError("BUSINESS_RULE", "This lead has no pending follow-up.");
  await completeFollowUp(db, actor, next.id);
}
