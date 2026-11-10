import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "@/server/db";
import { followUps, leadSources, leads, projects } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, forbidden, notFound } from "@/server/errors";
import { recordAssignment } from "./assignment";
import { audit, logActivity } from "./support";

/** Agents and managers can take an unassigned lead; admins assign instead. */
export const canClaim = (actor: Pick<Actor, "role">) => actor.role === "agent" || actor.role === "manager";

const isId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * Unassigned leads in a project, oldest first: what someone needs to decide to claim one. No phone
 * numbers or notes, because a lead's details belong to its owner and their managers.
 */
export async function listUnassigned(db: Database, actor: Actor, projectId: string | null) {
  if (!canClaim(actor) && actor.role !== "admin" && actor.role !== "super_admin") throw forbidden();
  if (!projectId) return [];
  return db
    .select({ id: leads.id, code: leads.code, name: leads.name, createdAt: leads.createdAt, priority: leads.priority, source: leadSources.name })
    .from(leads)
    .innerJoin(projects, eq(projects.id, leads.projectId))
    .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .where(and(eq(leads.projectId, projectId), isNull(leads.ownerId), isNull(leads.deletedAt)))
    .orderBy(desc(leads.priority), asc(leads.createdAt))
    .limit(200);
}

/**
 * Claims an unassigned lead. A single conditional update decides it, so when two people claim at
 * once exactly one succeeds and the other is told it has gone. A claimed lead's owner changes only
 * through an authorised reassignment, which is recorded.
 */
export async function claimLead(db: Database, actor: Actor, leadId: string) {
  if (!canClaim(actor)) throw forbidden();
  if (!isId(leadId)) throw notFound("Lead");
  return db.transaction(async (tx) => {
    const now = new Date();
    const [won] = await tx
      .update(leads)
      .set({ ownerId: actor.id, updatedAt: now })
      .where(and(eq(leads.id, leadId), isNull(leads.ownerId), isNull(leads.deletedAt)))
      .returning({ id: leads.id, code: leads.code, name: leads.name });
    if (!won) {
      const [exists] = await tx.select({ id: leads.id }).from(leads).where(and(eq(leads.id, leadId), isNull(leads.deletedAt)));
      if (!exists) throw notFound("Lead");
      throw new AppError("CONFLICT", "Someone else has already claimed this lead.");
    }
    await tx.update(followUps).set({ assigneeId: actor.id }).where(and(eq(followUps.leadId, leadId), eq(followUps.status, "pending")));
    await logActivity(tx, { leadId, actorId: actor.id, type: "assignment", data: { mode: "claim", ownerId: actor.id } });
    await recordAssignment(tx, { leadId, assigneeId: actor.id, mode: "claim", reason: `Claimed by ${actor.name}`, actorId: actor.id });
    await audit(tx, actor, "lead.claim", leadId, { ownerId: null }, { ownerId: actor.id });
    return { leadId, code: won.code, claimed: true };
  });
}
