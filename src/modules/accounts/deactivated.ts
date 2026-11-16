import { and, asc, desc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/server/db";
import { auditLogs, leads, signinLogs, teamMembers, teams, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { forbidden } from "@/server/errors";
import { canManageAccounts } from "./policy";

/**
 * Deactivated accounts (owner, 16 Nov 2026): every switched-off CRM account the actor may turn back
 * on, with when it was switched off and by whom (the latest "user.deactivate" audit entry). Admins
 * see every role but Super Admin; a Super Admin sees all. Reactivating goes through
 * setAccountStatus, so the same checks and the audit log apply.
 */
export async function listDeactivated(db: Database, actor: Actor) {
  if (!canManageAccounts(actor)) throw forbidden();
  const people = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(and(eq(users.status, "inactive"), actor.role === "super_admin" ? undefined : ne(users.role, "super_admin")))
    .orderBy(asc(sql`lower(${users.name})`));
  const ids = people.map((p) => p.id);
  if (ids.length === 0) return [];
  const by = alias(users, "deactivated_by");
  const [offEvents, teamRows, lastSignIns, openLeads] = await Promise.all([
    db
      .select({ userId: auditLogs.entityId, at: auditLogs.createdAt, byId: auditLogs.actorId, byName: by.name })
      .from(auditLogs)
      .leftJoin(by, eq(by.id, auditLogs.actorId))
      .where(and(eq(auditLogs.action, "user.deactivate"), inArray(auditLogs.entityId, ids)))
      .orderBy(desc(auditLogs.createdAt)),
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
  return people
    .map((p) => {
      // Newest first, so the first match is the latest switch-off.
      const off = offEvents.find((e) => e.userId === p.id);
      return {
        ...p,
        deactivatedAt: off?.at ?? null,
        deactivatedById: off?.byId ?? null,
        deactivatedByName: off?.byName ?? null,
        teams: teamRows.filter((t) => t.userId === p.id).map((t) => t.name),
        lastSignInAt: lastSignIns.find((s) => s.userId === p.id)?.at ?? null,
        openLeads: openLeads.find((l) => l.userId === p.id)?.n ?? 0,
      };
    })
    .sort((a, b) => (b.deactivatedAt?.getTime() ?? 0) - (a.deactivatedAt?.getTime() ?? 0) || a.name.localeCompare(b.name));
}
export type DeactivatedRow = Awaited<ReturnType<typeof listDeactivated>>[number];
