import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { Database } from "@/server/db";
import { leads, signinLogs, teamMembers, teams, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { forbidden } from "@/server/errors";

/**
 * Users & access (owner, 14 Nov 2026): a Super Admin sees every account with one on / off switch.
 * On = the role's normal access; off = no access (accounts/service.ts setAccountStatus: sign-in
 * refused, open sessions ended, audited). Leads stay with their owner until an Admin moves them.
 */
export const canManageAccess = (actor: Pick<Actor, "role">) => actor.role === "super_admin";

export async function listAccess(db: Database, actor: Actor) {
  if (!canManageAccess(actor)) throw forbidden();
  const people = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, status: users.status })
    .from(users)
    .orderBy(asc(sql`lower(${users.name})`));
  const ids = people.map((p) => p.id);
  if (ids.length === 0) return [];
  const [teamRows, lastSignIns, openLeads] = await Promise.all([
    db
      .select({ userId: teamMembers.userId, name: teams.name })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(and(inArray(teamMembers.userId, ids), eq(teams.isActive, true))),
    db
      .select({ userId: signinLogs.userId, at: sql<string>`max(${signinLogs.at})` })
      .from(signinLogs)
      .where(and(inArray(signinLogs.userId, ids), eq(signinLogs.event, "sign_in")))
      .groupBy(signinLogs.userId),
    db
      .select({ userId: leads.ownerId, n: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(inArray(leads.ownerId, ids), notInArray(leads.stage, ["booked", "lost_lead"]), isNull(leads.deletedAt)))
      .groupBy(leads.ownerId),
  ]);
  return people.map((p) => ({
    ...p,
    self: p.id === actor.id,
    teams: teamRows.filter((t) => t.userId === p.id).map((t) => t.name),
    lastSignInAt: lastSignIns.find((s) => s.userId === p.id)?.at ?? null,
    openLeads: openLeads.find((l) => l.userId === p.id)?.n ?? 0,
  }));
}
export type AccessRow = Awaited<ReturnType<typeof listAccess>>[number];
