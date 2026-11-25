import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "@/server/db";
import { leadRequests, leads, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { leadLink, notify } from "@/modules/notifications/service";
import { audit, isUniqueViolation, logActivity, type Tx } from "./support";

/**
 * Things an agent asks an Admin for on a lead (client, 25 Nov 2026): a name change, a wrong number to check,
 * and a sale reported as Successfully Booked. One of each kind waits at a time. Deciding is in decide-request.ts.
 */
export type LeadRequestType = "name_change" | "wrong_number" | "booked";
export const REQUEST_LABELS: Record<LeadRequestType, string> = { name_change: "Name change", wrong_number: "Wrong number", booked: "Successfully booked" };

export async function createRequest(
  tx: Tx,
  actor: Actor,
  lead: { id: string; code: string; name: string },
  type: LeadRequestType,
  data: Record<string, unknown>,
  note: string | null,
) {
  let id: string;
  try {
    [{ id }] = await tx.transaction((sp) => sp.insert(leadRequests).values({ type, leadId: lead.id, requestedById: actor.id, data, note }).returning({ id: leadRequests.id }));
  } catch (error) {
    if (isUniqueViolation(error, "lead_requests_one_pending_uq")) throw new AppError("CONFLICT", `${REQUEST_LABELS[type]}: one is already waiting for an Admin.`);
    throw error;
  }
  await logActivity(tx, { leadId: lead.id, actorId: actor.id, type: "request", body: note, data: { request: type, state: "pending", ...data } });
  await audit(tx, actor, "lead.request", lead.id, null, { requestId: id, type, ...data, note });
  const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.status, "active"), inArray(users.role, ["admin", "super_admin"])));
  await notify(
    tx,
    admins.map((a) => ({
      userId: a.id,
      type: "lead_request" as const,
      title: `${REQUEST_LABELS[type]} · ${lead.name}`,
      body: type === "name_change" ? `${actor.name} asks to rename ${lead.code}: ${String(data.from)} → ${String(data.to)}.` : `${actor.name} asks you to check lead ${lead.code}.`,
      link: leadLink(lead.id),
      dedupeKey: `lead_request:${id}`,
    })),
    actor.id,
  );
  return id;
}

/** The agent reported the number as wrong: only an Admin works the lead until it is checked. */
export async function reportWrongNumber(tx: Tx, actor: Actor, lead: { id: string; code: string; name: string; phoneE164: string }, note: string | null, now: Date) {
  const id = await createRequest(tx, actor, lead, "wrong_number", { phone: lead.phoneE164 }, note);
  await tx.update(leads).set({ wrongNumberAt: now, updatedAt: now }).where(eq(leads.id, lead.id));
  return id;
}

const selection = {
  id: leadRequests.id,
  type: leadRequests.type,
  data: leadRequests.data,
  note: leadRequests.note,
  createdAt: leadRequests.createdAt,
  requestedBy: users.name,
  leadId: leads.id,
  leadName: leads.name,
  leadCode: leads.code,
  phoneCountryCode: leads.phoneCountryCode,
  phoneNumber: leads.phoneNumber,
};

/** What waits on one lead. */
export async function leadRequestsFor(db: Database, leadId: string) {
  const rows = await db
    .select(selection)
    .from(leadRequests)
    .innerJoin(leads, eq(leads.id, leadRequests.leadId))
    .innerJoin(users, eq(users.id, leadRequests.requestedById))
    .where(and(eq(leadRequests.leadId, leadId), eq(leadRequests.status, "pending")))
    .orderBy(asc(leadRequests.createdAt));
  return rows.map((r) => ({ ...r, type: r.type as LeadRequestType }));
}
export type LeadRequestRow = Awaited<ReturnType<typeof leadRequestsFor>>[number];

/** What waits in a project, oldest first. The page is for Admins and Super Admins. */
export async function pendingLeadRequests(db: Database, projectId: string) {
  const rows = await db
    .select(selection)
    .from(leadRequests)
    .innerJoin(leads, eq(leads.id, leadRequests.leadId))
    .innerJoin(users, eq(users.id, leadRequests.requestedById))
    .where(and(eq(leads.projectId, projectId), isNull(leads.deletedAt), eq(leadRequests.status, "pending")))
    .orderBy(asc(leadRequests.createdAt))
    .limit(200);
  return rows.map((r) => ({ ...r, type: r.type as LeadRequestType }));
}
