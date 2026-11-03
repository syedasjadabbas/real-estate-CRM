import { and, asc, count, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { Database } from "@/server/db";
import { auditLogs, employeeProfiles, leads, sessions, teamMembers, teams, users } from "@/server/db/schema";
import type { Actor, Role } from "@/server/auth/types";
import { hashPassword } from "@/server/auth/password";
import { AppError, notFound } from "@/server/errors";
import { assignLead } from "@/modules/leads/commands";
import { isUniqueViolation } from "@/modules/leads/support";
import { parseTask as parse } from "@/modules/tasks/support";
import { assertCanManageAccount, assertCanManageAccounts, assertNotSelf } from "./policy";
import { accountStatusSchema, createAccountSchema, reassignLeadsSchema, resetPasswordSchema, updateAccountSchema } from "./validation";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const fieldError = (field: string, message: string) => new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { [field]: message } });

async function loadUser(db: Database | Tx, userId: string, lock = false) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw notFound("User");
  const q = db.select({ id: users.id, name: users.name, email: users.email, role: users.role, status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
  const [user] = lock ? await q.for("update") : await q;
  if (!user) throw notFound("User");
  return user;
}

/** Same effect as `revokeAllSessions` (session-store.ts), inside the caller's transaction. */
async function endSessions(tx: Tx, userId: string) {
  await tx.delete(sessions).where(eq(sessions.userId, userId));
}

async function writeAudit(tx: Tx, actor: Actor, action: string, userId: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  await tx.insert(auditLogs).values({ actorId: actor.id, action, entity: "user", entityId: userId, before, after });
}

/** The last active Super Admin can't be demoted or deactivated (nobody could manage accounts afterwards). */
async function assertNotLastSuperAdmin(tx: Tx, user: { id: string; role: Role; status: string }) {
  if (user.role !== "super_admin" || user.status !== "active") return;
  const [{ n }] = await tx.select({ n: count() }).from(users).where(and(eq(users.role, "super_admin"), eq(users.status, "active")));
  if (n <= 1) throw new AppError("BUSINESS_RULE", "This is the last active Super Admin. Make another user Super Admin first.");
}

/** Team rules (T-A2): managers of a team must keep the manager role; members must be agents or managers. */
async function assertRoleFitsTeams(tx: Tx, userId: string, nextRole: Role) {
  if (nextRole !== "manager") {
    const managed = await tx.select({ name: teams.name }).from(teams).where(eq(teams.managerId, userId)).orderBy(asc(teams.name));
    if (managed.length) throw fieldError("role", `Manages ${managed.map((t) => t.name).join(", ")}. Assign another manager to the team first.`);
  }
  if (nextRole !== "agent" && nextRole !== "manager") {
    const member = await tx.select({ name: teams.name }).from(teamMembers).innerJoin(teams, eq(teams.id, teamMembers.teamId)).where(eq(teamMembers.userId, userId)).orderBy(asc(teams.name));
    if (member.length) throw fieldError("role", `Member of ${member.map((t) => t.name).join(", ")}. Only agents and managers can be team members; remove them from the team first.`);
  }
}

/** Creates a CRM account (Admin / Super Admin). The password is hashed and never returned or audited. */
export async function createAccount(db: Database, actor: Actor, input: unknown) {
  assertCanManageAccounts(actor);
  const data = parse(createAccountSchema, input);
  assertCanManageAccount(actor, data.role);
  const passwordHash = await hashPassword(data.password);
  try {
    return await db.transaction(async (tx) => {
      const [taken] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${data.email}`).limit(1);
      if (taken) throw fieldError("email", "An account with this email already exists");
      const [user] = await tx.insert(users).values({ name: data.name, email: data.email, role: data.role, passwordHash }).returning({ id: users.id });
      await writeAudit(tx, actor, "user.create", user.id, null, { name: data.name, email: data.email, role: data.role, status: "active", employeeRecordId: data.employeeRecordId });
      if (data.employeeRecordId) {
        // The HR record (profile fields and history) now belongs to this account.
        const [linked] = await tx
          .update(employeeProfiles)
          .set({ userId: user.id, updatedById: actor.id, updatedAt: new Date() })
          .where(and(eq(employeeProfiles.id, data.employeeRecordId), sql`${employeeProfiles.userId} is null`))
          .returning({ id: employeeProfiles.id });
        if (!linked) throw fieldError("employeeRecordId", "This HR record is no longer available to link");
        await tx.insert(auditLogs).values({ actorId: actor.id, action: "employee.record_link", entity: "employee_profile", entityId: user.id, before: { recordId: linked.id }, after: { userId: user.id } });
      }
      return { id: user.id };
    });
  } catch (error) {
    // Two admins creating the same email at once: the unique index decides.
    if (isUniqueViolation(error, "users_email_lower_uq")) throw fieldError("email", "An account with this email already exists");
    throw error;
  }
}

/** Changes name and / or role. Role changes respect the Super Admin and team rules. */
export async function updateAccount(db: Database, actor: Actor, userId: string, input: unknown) {
  assertCanManageAccounts(actor);
  const data = parse(updateAccountSchema, input);
  return db.transaction(async (tx) => {
    const user = await loadUser(tx, userId, true);
    const nextRole = data.role ?? user.role;
    assertCanManageAccount(actor, user.role, nextRole);
    if (nextRole !== user.role) {
      assertNotSelf(actor, userId, "change the role of");
      if (user.role === "super_admin") await assertNotLastSuperAdmin(tx, user);
      await assertRoleFitsTeams(tx, userId, nextRole);
    }
    const next = { name: data.name ?? user.name, role: nextRole };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== user[k]);
    if (!changed.length) return { changed: [] as string[] };
    await tx.update(users).set(next).where(eq(users.id, userId));
    // A new role changes what the person may see: end their sessions so it applies immediately.
    if (changed.includes("role")) await endSessions(tx, userId);
    await writeAudit(tx, actor, "user.update", userId, Object.fromEntries(changed.map((k) => [k, user[k]])), Object.fromEntries(changed.map((k) => [k, next[k]])));
    return { changed: changed as string[] };
  });
}

/** Sets a new password chosen by the admin; every session of the user ends (SECURITY_AND_PRIVACY.md §1). */
export async function resetAccountPassword(db: Database, actor: Actor, userId: string, input: unknown) {
  assertCanManageAccounts(actor);
  const { password } = parse(resetPasswordSchema, input);
  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    const user = await loadUser(tx, userId, true);
    assertCanManageAccount(actor, user.role);
    if (password.trim().toLowerCase() === user.email.toLowerCase()) throw fieldError("password", "The password cannot be the email address");
    await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
    await endSessions(tx, userId);
    await writeAudit(tx, actor, "user.password_reset", userId, null, { sessionsEnded: true });
    return { ok: true };
  });
}

/**
 * Manual deactivation / reactivation (Q3). An inactive user can't sign in (`login.ts`) and their
 * sessions stop working (`session-store.ts` loads active users only); sessions are also deleted.
 * Leads are not moved here: that is the separate, explicit lead shift.
 */
export async function setAccountStatus(db: Database, actor: Actor, userId: string, input: unknown) {
  assertCanManageAccounts(actor);
  const { status } = parse(accountStatusSchema, input);
  return db.transaction(async (tx) => {
    const user = await loadUser(tx, userId, true);
    assertCanManageAccount(actor, user.role);
    if (user.status === status) return { changed: false };
    if (status === "inactive") {
      assertNotSelf(actor, userId, "deactivate");
      await assertNotLastSuperAdmin(tx, user);
    }
    await tx.update(users).set({ status }).where(eq(users.id, userId));
    if (status === "inactive") await endSessions(tx, userId);
    await writeAudit(tx, actor, status === "inactive" ? "user.deactivate" : "user.reactivate", userId, { status: user.status }, { status });
    return { changed: true };
  });
}

const OPEN_STAGES_EXCLUDED = ["booked", "lost_lead"] as const;

/** Counts of the leads a user owns, by group, for the lead shift dialog. */
export async function ownedLeadSummary(db: Database, actor: Actor, userId: string) {
  assertCanManageAccounts(actor);
  await loadUser(db, userId);
  const [row] = await db
    .select({
      open: sql<number>`count(*) filter (where ${leads.stage} not in ('booked', 'lost_lead'))::int`,
      lost: sql<number>`count(*) filter (where ${leads.stage} = 'lost_lead')::int`,
      booked: sql<number>`count(*) filter (where ${leads.stage} = 'booked')::int`,
    })
    .from(leads)
    .where(and(eq(leads.ownerId, userId), isNull(leads.deletedAt)));
  return row;
}

/**
 * The questionnaire's "lead shift option" (Q3): moves the chosen groups of a user's leads to
 * another agent or manager. Each lead goes through the normal reassignment (`assignLead`), so
 * pending follow-ups move with it and every move is logged, audited and notified. Tasks and
 * meetings are not moved: whether they should is open (clarification C-2).
 */
export async function reassignOwnedLeads(db: Database, actor: Actor, fromUserId: string, input: unknown) {
  assertCanManageAccounts(actor);
  const data = parse(reassignLeadsSchema, input);
  const from = await loadUser(db, fromUserId);
  assertCanManageAccount(actor, from.role);
  if (data.toUserId === fromUserId) throw fieldError("toUserId", "Choose a different person");
  const stageFilter = [
    data.open ? notInArray(leads.stage, [...OPEN_STAGES_EXCLUDED]) : undefined,
    data.lost ? eq(leads.stage, "lost_lead") : undefined,
    data.booked ? eq(leads.stage, "booked") : undefined,
  ].filter((c) => c !== undefined);
  const rows = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.ownerId, fromUserId), isNull(leads.deletedAt), sql`(${sql.join(stageFilter, sql` or `)})`))
    .orderBy(asc(leads.createdAt));
  let moved = 0;
  try {
    for (const { id } of rows) {
      // assignLead validates the receiver (active agent or manager the actor may assign to).
      await assignLead(db, actor, id, { ownerId: data.toUserId });
      moved++;
    }
  } finally {
    // One summary row on the person's account history, besides each lead's own `lead.assign` row.
    if (moved > 0) {
      await db.insert(auditLogs).values({
        actorId: actor.id,
        action: "user.leads_shift",
        entity: "user",
        entityId: fromUserId,
        before: null,
        after: { toUserId: data.toUserId, open: data.open, lost: data.lost, booked: data.booked, moved, matched: rows.length },
      });
    }
  }
  return { moved };
}

/** Active agents and managers who can receive leads, for the lead shift dialog. */
export async function leadReceivers(db: Database, actor: Actor, excludeUserId: string) {
  assertCanManageAccounts(actor);
  const rows = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.status, "active"), inArray(users.role, ["agent", "manager"])))
    .orderBy(asc(sql`lower(${users.name})`));
  return rows.filter((r) => r.id !== excludeUserId);
}

/** HR records without a CRM login that a new account can be linked to (Q1). */
export async function linkableRecords(db: Database, actor: Actor) {
  assertCanManageAccounts(actor);
  return db
    .select({ id: employeeProfiles.id, name: employeeProfiles.fullName, email: employeeProfiles.email })
    .from(employeeProfiles)
    .where(and(sql`${employeeProfiles.userId} is null`, eq(employeeProfiles.status, "active")))
    .orderBy(asc(sql`lower(${employeeProfiles.fullName})`));
}
