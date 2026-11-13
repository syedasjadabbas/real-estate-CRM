import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/server/db";
import { leads, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, forbidden } from "@/server/errors";
import { leadLink, notify } from "@/modules/notifications/service";
import { formatPhone } from "./phone";
import { audit, loadAccessibleLead, logActivity } from "./support";

/**
 * Lead verification (owner's decision, 13 Nov 2026). A lead an agent adds by hand starts as
 * "pending": the agent can see it but not work on it until an Admin or Super Admin approves it.
 * A rejected lead goes back to the agent with the reason; the agent corrects the details and
 * resubmits it. Leads added by managers, admins and super admins, imported leads (approved as a
 * batch) and every lead created before this rule are approved.
 */
export type Verification = "pending" | "approved" | "rejected";

export const canVerifyLeads = (actor: Pick<Actor, "role">) => actor.role === "admin" || actor.role === "super_admin";

/** The state a new lead starts in. */
export const initialVerification = (actor: Pick<Actor, "role">): Verification => (actor.role === "agent" ? "pending" : "approved");

export const PENDING_MESSAGE = "This lead is waiting for verification by an Admin or Super Admin. You can work on it once it is approved.";
export const REJECTED_MESSAGE = "This lead was rejected in verification. Correct the details and resubmit it for verification.";

/**
 * Work on a lead (stage, notes, follow-ups, meetings, files, bookings, tasks, lost) needs it to be
 * approved, except for Admins and Super Admins, who verify it. Editing a rejected lead's details is
 * allowed so the agent can correct it (`allowRejectedEdit`).
 */
export function assertWorkable(actor: Pick<Actor, "role">, lead: { verification: Verification }, opts: { allowRejectedEdit?: boolean } = {}) {
  if (canVerifyLeads(actor) || lead.verification === "approved") return;
  if (lead.verification === "rejected" && opts.allowRejectedEdit) return;
  throw new AppError("BUSINESS_RULE", lead.verification === "pending" ? PENDING_MESSAGE : REJECTED_MESSAGE);
}

/** Admins and Super Admins hear about a lead waiting for them (called inside createLead's transaction). */
export async function notifyVerifiers(db: Parameters<typeof notify>[0], actor: Actor, lead: { id: string; code: string; name: string }) {
  const ids = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.status, "active"), inArray(users.role, ["admin", "super_admin"])))
  ).map((u) => u.id);
  await notify(
    db,
    ids.map((userId) => ({
      userId,
      type: "lead_verification_requested" as const,
      title: `Lead to verify: ${lead.name} (${lead.code})`,
      body: `Added by ${actor.name}.`,
      link: leadLink(lead.id),
      dedupeKey: `lead-verify:${lead.id}:${Date.now()}`,
    })),
    actor.id,
  );
}

/** Approve or reject a pending lead. Rejection needs a reason, which the agent sees. */
export async function verifyLead(db: Database, actor: Actor, leadId: string, input: { approve?: unknown; note?: unknown }) {
  if (!canVerifyLeads(actor)) throw forbidden("Only an Admin or Super Admin can verify leads.");
  const approve = input.approve === true;
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 1000) : "";
  if (!approve && !note) throw new AppError("VALIDATION_FAILED", "Give a reason for rejecting the lead.", { fields: { note: "Give a reason" } });
  return db.transaction(async (tx) => {
    const { lead } = await loadAccessibleLead(tx, actor, leadId, true);
    if (lead.verification !== "pending") throw new AppError("BUSINESS_RULE", "This lead is not waiting for verification.");
    const now = new Date();
    const status: Verification = approve ? "approved" : "rejected";
    await tx
      .update(leads)
      .set({ verification: status, verificationNote: approve ? null : note, verifiedById: actor.id, verifiedAt: now, updatedAt: now })
      .where(eq(leads.id, leadId));
    await logActivity(tx, { leadId, actorId: actor.id, type: "verification", data: { status, ...(note ? { note } : {}) } });
    await audit(tx, actor, approve ? "lead.verify_approve" : "lead.verify_reject", leadId, { verification: "pending" }, { verification: status, note: note || null });
    if (lead.ownerId) {
      await notify(
        tx,
        [
          {
            userId: lead.ownerId,
            type: "lead_verified",
            title: approve ? `Lead approved: ${lead.name} (${lead.code})` : `Lead rejected: ${lead.name} (${lead.code})`,
            body: approve ? "You can now work on it." : `Reason: ${note}. Correct it and resubmit.`,
            link: leadLink(leadId),
            dedupeKey: `lead-verified:${leadId}:${now.getTime()}`,
          },
        ],
        actor.id,
      );
    }
    return { status };
  });
}

/** The agent sends a corrected, rejected lead back for verification. */
export async function resubmitLead(db: Database, actor: Actor, leadId: string) {
  return db.transaction(async (tx) => {
    const { lead } = await loadAccessibleLead(tx, actor, leadId, true);
    if (lead.verification !== "rejected") throw new AppError("BUSINESS_RULE", "Only a rejected lead can be resubmitted.");
    if (actor.role === "agent" && lead.ownerId !== actor.id) throw forbidden();
    const now = new Date();
    await tx.update(leads).set({ verification: "pending", updatedAt: now }).where(eq(leads.id, leadId));
    await logActivity(tx, { leadId, actorId: actor.id, type: "verification", data: { status: "pending", resubmitted: true } });
    await audit(tx, actor, "lead.verify_resubmit", leadId, { verification: "rejected" }, { verification: "pending" });
    await notifyVerifiers(tx, actor, lead);
    return { status: "pending" as const };
  });
}

/** Leads waiting for verification in a project, oldest first (Admins and Super Admins). */
export async function pendingVerification(db: Database, actor: Actor, projectId: string) {
  if (!canVerifyLeads(actor)) throw forbidden();
  const owner = alias(users, "verify_owner");
  const rows = await db
    .select({
      id: leads.id,
      code: leads.code,
      name: leads.name,
      phoneCountryCode: leads.phoneCountryCode,
      phoneNumber: leads.phoneNumber,
      ownerName: owner.name,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .leftJoin(owner, eq(owner.id, leads.ownerId))
    .where(and(eq(leads.projectId, projectId), eq(leads.verification, "pending"), isNull(leads.deletedAt)))
    .orderBy(asc(leads.createdAt));
  return rows.map((r) => ({ ...r, phone: formatPhone(r.phoneCountryCode, r.phoneNumber) }));
}

/** How many leads wait for verification in a project (for the Verify tab). */
export async function pendingVerificationCount(db: Database, actor: Actor, projectId: string | null) {
  if (!canVerifyLeads(actor) || !projectId) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(leads)
    .where(and(eq(leads.projectId, projectId), eq(leads.verification, "pending"), isNull(leads.deletedAt)));
  return row?.n ?? 0;
}
