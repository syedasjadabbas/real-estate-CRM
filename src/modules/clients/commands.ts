import { and, eq, isNull, ne } from "drizzle-orm";
import type { Database } from "@/server/db";
import { bookings, clientFollowUps, clients, leads, users } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { resolveCity } from "@/modules/cities/resolve";
import { clientPhonesOf, clientWithAnyNumber, copyLeadPhonesToClient, leadPhonesOf, lockNumbers, normalizeExtraPhones, replaceClientPhones } from "@/modules/contacts/phones";
import { AppError, forbidden, notFound } from "@/server/errors";
import { normalizePhone } from "@/modules/leads/phone";
import { canAssignTo } from "@/modules/leads/policy";
import { isUniqueViolation, loadAccessibleLead, logActivity, type Tx } from "@/modules/leads/support";
import { assignSchema, followUpSchema, noteSchema } from "@/modules/leads/validation";
import { assertCanClient, canAccessClient } from "./policy";
import {
  auditClient,
  loadAccessibleClient,
  logClientActivity,
  parse,
  refreshClientNextFollowUp,
  teamMemberIds,
} from "./support";
import { convertLeadSchema, createClientSchema, updateClientSchema } from "./validation";

const PHONE_TAKEN = "A client with this phone number already exists.";

/**
 * FR-025: every way a lead gets its client also goes on the lead's own timeline. It holds no
 * client name, because the booking paths link clients the lead's viewers may not have access to.
 */
function logClientLink(tx: Tx, actor: Actor, leadId: string, clientId: string, mode: "converted" | "linked" | "booking_linked" | "booking_created") {
  return logActivity(tx, { leadId, actorId: actor.id, type: "client_linked", data: { clientId, mode } });
}

function phoneOrThrow(countryCode: string, number: string) {
  const phone = normalizePhone(countryCode, number);
  if (!phone) {
    throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", {
      fields: { phoneNumber: "Enter a valid phone number" },
    });
  }
  return phone;
}

/** Validates a prospective owner: an active agent/manager the actor may assign to. */
async function assertOwner(tx: Tx, actor: Actor, ownerId: string, members: string[]) {
  const [owner] = await tx
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users)
    .where(eq(users.id, ownerId))
    .limit(1);
  if (!owner || owner.status !== "active" || !["agent", "manager"].includes(owner.role)) {
    throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", {
      fields: { ownerId: "Choose an active agent or manager" },
    });
  }
  if (!canAssignTo(actor, ownerId, members)) throw forbidden("You cannot assign clients to that user.");
}

/**
 * The client already holding this phone, described only as far as the actor may see it
 * (one client per person across projects; never reveals another team's client).
 */
/** The client holding any of these numbers (one client per person; phone numbers identify them). */
async function existingByPhone(tx: Tx, actor: Actor, numbers: string | string[], members: string[], exceptClientId?: string) {
  const existing = await clientWithAnyNumber(tx, Array.isArray(numbers) ? numbers : [numbers], exceptClientId);
  if (!existing) return null;
  return { client: existing, visible: canAccessClient(actor, existing.ownerId, members) };
}

function duplicateError(existing: { client: { id: string; name: string }; visible: boolean }) {
  return new AppError(
    "CONFLICT",
    existing.visible ? PHONE_TAKEN : `${PHONE_TAKEN} It belongs to another team; ask an admin to link it.`,
    { details: existing.visible ? { existingClientId: existing.client.id, existingName: existing.client.name } : {} },
  );
}

/** Manual client (admins; FR-050 "or manually by admin"). */
export async function createClient(db: Database, actor: Actor, input: unknown) {
  assertCanClient(actor, "createManual");
  const data = parse(createClientSchema, input);
  const phone = phoneOrThrow(data.phoneCountryCode, data.phoneNumber);
  const extraPhones = normalizeExtraPhones(phone.e164, data.phones);
  const numbers = [phone.e164, ...extraPhones.map((p) => p.e164)];

  return db.transaction(async (tx) => {
    await lockNumbers(tx, numbers);
    const members = await teamMemberIds(tx, actor);
    const existing = await existingByPhone(tx, actor, numbers, members);
    if (existing) throw duplicateError(existing);
    if (data.ownerId) await assertOwner(tx, actor, data.ownerId, members);

    const city = await resolveCity(tx, data);
    const values = {
      name: data.name,
      phoneCountryCode: phone.countryCode,
      phoneNumber: phone.national,
      phoneE164: phone.e164,
      email: data.email ?? null,
      ...city,
      relationship: data.relationship ?? null,
      ownerId: data.ownerId ?? actor.id,
      createdById: actor.id,
    };
    let created: { id: string };
    try {
      [created] = await tx.transaction((sp) => sp.insert(clients).values(values).returning({ id: clients.id }));
    } catch (error) {
      if (isUniqueViolation(error, "clients_phone_e164_uq")) throw new AppError("CONFLICT", PHONE_TAKEN);
      throw error;
    }
    await logClientActivity(tx, { clientId: created.id, actorId: actor.id, type: "created", data: { mode: "manual" } });
    await auditClient(tx, actor, "client.create", created.id, null, values);
    await replaceClientPhones(tx, created.id, extraPhones);
    return { clientId: created.id };
  });
}

export type ConvertOutcome = { outcome: "created" | "linked"; clientId: string };

const openUnlinkedBookings = (leadId: string) => and(eq(bookings.leadId, leadId), isNull(bookings.clientId), ne(bookings.stage, "cancelled"));

/**
 * F-13: a lead's open bookings belong to its client as soon as the lead has one, so they show on the
 * client page. Only the link is written: payments, stages and units don't change.
 */
export async function linkLeadBookings(tx: Tx, leadId: string, clientId: string) {
  const linked = await tx.update(bookings).set({ clientId }).where(openUnlinkedBookings(leadId)).returning({ id: bookings.id });
  return linked.map((b) => b.id);
}

/**
 * Lead → client (managers for their team's leads, admins for any). A lead whose phone already
 * belongs to a visible client is linked to it on request instead of creating a second client.
 */
export async function convertLeadToClient(db: Database, actor: Actor, input: unknown): Promise<ConvertOutcome> {
  assertCanClient(actor, "convertLead");
  const { leadId, onExisting } = parse(convertLeadSchema, input);

  return db.transaction(async (tx) => {
    // The lead's bookings are locked before the lead itself, the order confirmation uses, so the two can't deadlock.
    await loadAccessibleLead(tx, actor, leadId);
    await tx.select({ id: bookings.id }).from(bookings).where(openUnlinkedBookings(leadId)).for("update");
    const { lead, members } = await loadAccessibleLead(tx, actor, leadId, true);
    // Every lead has its person's client since 13 Nov 2026; converting returns that client (kept for API callers).
    if (lead.clientId) return { outcome: "linked", clientId: lead.clientId };
    const now = new Date();

    const leadNumbers = [lead.phoneE164, ...(await leadPhonesOf(tx, lead.id)).map((p) => p.e164)];
    const existing = await existingByPhone(tx, actor, leadNumbers, members);
    if (existing) {
      if (!existing.visible || onExisting !== "link") throw duplicateError(existing);
      await tx.update(leads).set({ clientId: existing.client.id }).where(eq(leads.id, lead.id));
      await logClientLink(tx, actor, lead.id, existing.client.id, "linked");
      await tx.update(clients).set({ updatedAt: now, lastActivityAt: now }).where(eq(clients.id, existing.client.id));
      await logClientActivity(tx, {
        clientId: existing.client.id,
        actorId: actor.id,
        type: "lead_linked",
        data: { leadId: lead.id, leadCode: lead.code },
      });
      const bookingIds = await linkLeadBookings(tx, lead.id, existing.client.id);
      await auditClient(tx, actor, "client.link_lead", existing.client.id, null, { leadId: lead.id, bookingIds });
      return { outcome: "linked", clientId: existing.client.id };
    }

    const values = {
      name: lead.name,
      phoneCountryCode: lead.phoneCountryCode,
      phoneNumber: lead.phoneNumber,
      phoneE164: lead.phoneE164,
      email: lead.email,
      cityId: lead.cityId,
      cityOther: lead.cityOther,
      ownerId: lead.ownerId ?? actor.id,
      createdById: actor.id,
    };
    let created: { id: string };
    try {
      [created] = await tx.transaction((sp) => sp.insert(clients).values(values).returning({ id: clients.id }));
    } catch (error) {
      if (isUniqueViolation(error, "clients_phone_e164_uq")) throw new AppError("CONFLICT", PHONE_TAKEN);
      throw error;
    }
    await tx.update(leads).set({ clientId: created.id }).where(eq(leads.id, lead.id));
    await logClientLink(tx, actor, lead.id, created.id, "converted");
    await logClientActivity(tx, {
      clientId: created.id,
      actorId: actor.id,
      type: "created",
      data: { mode: "lead", leadId: lead.id, leadCode: lead.code },
    });
    await copyLeadPhonesToClient(tx, lead.id, created.id);
    const bookingIds = await linkLeadBookings(tx, lead.id, created.id);
    await auditClient(tx, actor, "client.convert", created.id, null, { ...values, leadId: lead.id, bookingIds });
    return { outcome: "created", clientId: created.id };
  });
}

export async function updateClient(db: Database, actor: Actor, clientId: string, input: unknown) {
  assertCanClient(actor, "edit");
  const data = parse(updateClientSchema, input);
  return db.transaction(async (tx) => {
    const { client } = await loadAccessibleClient(tx, actor, clientId, true);
    const changes: Partial<typeof clients.$inferInsert> = {};
    if (data.name !== undefined) changes.name = data.name;
    if (data.phoneNumber !== undefined || data.phoneCountryCode !== undefined) {
      const phone = phoneOrThrow(data.phoneCountryCode ?? client.phoneCountryCode, data.phoneNumber ?? client.phoneNumber);
      changes.phoneCountryCode = phone.countryCode;
      changes.phoneNumber = phone.national;
      changes.phoneE164 = phone.e164;
    }
    let phonesChanged = false;
    if (data.phones !== undefined) {
      const primary = changes.phoneE164 ?? client.phoneE164;
      const extra = normalizeExtraPhones(primary, data.phones);
      const after = extra.map((p) => p.e164);
      const before = (await clientPhonesOf(tx, clientId)).map((p) => p.e164);
      if (JSON.stringify(after) !== JSON.stringify(before)) {
        await lockNumbers(tx, after);
        const other = await existingByPhone(tx, actor, after, [], clientId);
        if (other) {
          throw new AppError("CONFLICT", "Another client already uses one of these phone numbers.", { fields: { phones: "Another client already uses one of these numbers" } });
        }
        await replaceClientPhones(tx, clientId, extra);
        phonesChanged = true;
      }
    }
    if ("email" in data) changes.email = data.email ?? null;
    if ("cityId" in data) Object.assign(changes, await resolveCity(tx, data, client));
    if ("relationship" in data) changes.relationship = data.relationship ?? null;

    const changed = Object.keys(changes).filter(
      (key) => String(changes[key as keyof typeof changes] ?? "") !== String(client[key as keyof typeof client] ?? ""),
    );
    if (phonesChanged) changed.push("phones");
    if (changed.length === 0) return { changed: [] as string[] };

    const now = new Date();
    try {
      await tx.transaction((sp) => sp.update(clients).set({ ...changes, updatedAt: now }).where(eq(clients.id, clientId)));
    } catch (error) {
      if (isUniqueViolation(error, "clients_phone_e164_uq")) {
        throw new AppError("CONFLICT", "Another client already uses this phone number.", {
          fields: { phoneNumber: "Another client already uses this phone number" },
        });
      }
      throw error;
    }
    await logClientActivity(tx, { clientId, actorId: actor.id, type: "update", data: { fields: changed } });
    await auditClient(
      tx,
      actor,
      "client.update",
      clientId,
      Object.fromEntries(changed.map((k) => [k, client[k as keyof typeof client]])),
      Object.fromEntries(changed.map((k) => [k, changes[k as keyof typeof changes]])),
    );
    return { changed };
  });
}

export async function assignClient(db: Database, actor: Actor, clientId: string, input: unknown) {
  assertCanClient(actor, "assign");
  const { ownerId } = parse(assignSchema, input);
  return db.transaction(async (tx) => {
    const { client, members } = await loadAccessibleClient(tx, actor, clientId, true);
    if (client.ownerId === ownerId) return;
    await assertOwner(tx, actor, ownerId, members);
    const now = new Date();
    await tx.update(clients).set({ ownerId, updatedAt: now }).where(eq(clients.id, clientId));
    await logClientActivity(tx, { clientId, actorId: actor.id, type: "assignment", data: { from: client.ownerId, to: ownerId } });
    await auditClient(tx, actor, "client.assign", clientId, { ownerId: client.ownerId }, { ownerId });
  });
}

export async function addClientNote(db: Database, actor: Actor, clientId: string, input: unknown) {
  assertCanClient(actor, "edit");
  const { body } = parse(noteSchema, input);
  return db.transaction(async (tx) => {
    await loadAccessibleClient(tx, actor, clientId, true);
    const now = new Date();
    await logClientActivity(tx, { clientId, actorId: actor.id, type: "note", body });
    await tx.update(clients).set({ lastActivityAt: now, updatedAt: now }).where(eq(clients.id, clientId));
    await auditClient(tx, actor, "client.note", clientId, null, { body });
  });
}

export async function scheduleClientFollowUp(db: Database, actor: Actor, clientId: string, input: unknown, now = new Date()) {
  assertCanClient(actor, "edit");
  const { dueAt, note } = parse(followUpSchema, input);
  if (dueAt.getTime() < now.getTime() - 60_000) {
    throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { dueAt: "Pick a time in the future" } });
  }
  return db.transaction(async (tx) => {
    const { client } = await loadAccessibleClient(tx, actor, clientId, true);
    const assigneeId = client.ownerId ?? actor.id;
    const [followUp] = await tx
      .insert(clientFollowUps)
      .values({ clientId, assigneeId, dueAt, note: note ?? null, createdById: actor.id })
      .returning({ id: clientFollowUps.id });
    await auditClient(tx, actor, "client.follow_up", clientId, null, { followUpId: followUp.id, dueAt: dueAt.toISOString(), assigneeId, note: note ?? null, status: "pending" });
    await tx.update(clients).set({ lastActivityAt: now, updatedAt: now }).where(eq(clients.id, clientId));
    await refreshClientNextFollowUp(tx, clientId);
    await logClientActivity(tx, {
      clientId,
      actorId: actor.id,
      type: "follow_up_scheduled",
      body: note ?? null,
      data: { followUpId: followUp.id, dueAt: dueAt.toISOString() },
    });
    return followUp;
  });
}

export async function completeClientFollowUp(db: Database, actor: Actor, followUpId: string) {
  assertCanClient(actor, "edit");
  if (!/^[0-9a-f-]{36}$/i.test(followUpId)) throw notFound("Follow-up");
  return db.transaction(async (tx) => {
    const [followUp] = await tx.select().from(clientFollowUps).where(eq(clientFollowUps.id, followUpId)).limit(1).for("update");
    if (!followUp) throw notFound("Follow-up");
    await loadAccessibleClient(tx, actor, followUp.clientId, true);
    if (followUp.status !== "pending") throw new AppError("BUSINESS_RULE", "This follow-up is already closed.");
    const now = new Date();
    await tx
      .update(clientFollowUps)
      .set({ status: "done", doneAt: now, doneById: actor.id })
      .where(eq(clientFollowUps.id, followUpId));
    await tx.update(clients).set({ lastActivityAt: now, updatedAt: now }).where(eq(clients.id, followUp.clientId));
    await refreshClientNextFollowUp(tx, followUp.clientId);
    await logClientActivity(tx, {
      clientId: followUp.clientId,
      actorId: actor.id,
      type: "follow_up_done",
      data: { followUpId, dueAt: followUp.dueAt.toISOString() },
    });
    await auditClient(tx, actor, "client.follow_up_done", followUp.clientId, { followUpId, status: followUp.status }, { followUpId, status: "done", dueAt: followUp.dueAt.toISOString(), doneAt: now.toISOString() });
  });
}

type BookedLead = { id: string; code: string; name: string; phoneCountryCode: string; phoneNumber: string; phoneE164: string; email: string | null; cityId: string | null; cityOther: string | null; ownerId: string | null; clientId: string | null };

/**
 * The client this lead already belongs to, or null. Uses the lead's client, else the client with the
 * same phone (one client per person), linking the lead and its open bookings to it. Never creates a
 * client: that waits for confirmation (FR-050). Runs inside the booking transaction with the lead
 * row locked; visibility rules don't apply because this is the system linking records.
 */
export async function linkExistingClient(tx: Tx, actor: Actor, lead: BookedLead, bookingId: string): Promise<string | null> {
  if (lead.clientId) {
    await linkLeadBookings(tx, lead.id, lead.clientId);
    return lead.clientId;
  }
  const now = new Date();
  const [existing] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.phoneE164, lead.phoneE164)).limit(1).for("update");
  if (!existing) return null;
  await tx.update(leads).set({ clientId: existing.id }).where(eq(leads.id, lead.id));
  await logClientLink(tx, actor, lead.id, existing.id, "booking_linked");
  await tx.update(clients).set({ updatedAt: now, lastActivityAt: now }).where(eq(clients.id, existing.id));
  await logClientActivity(tx, { clientId: existing.id, actorId: actor.id, type: "lead_linked", data: { leadId: lead.id, leadCode: lead.code, bookingId } });
  await auditClient(tx, actor, "client.link_lead", existing.id, null, { leadId: lead.id, bookingId });
  await linkLeadBookings(tx, lead.id, existing.id);
  return existing.id;
}

/**
 * FR-050: a confirmed booking's lead appears in Clients, linked: to the client it already belongs
 * to (`linkExistingClient`), else to a new one owned by the lead's owner.
 */
export async function ensureClientForLead(tx: Tx, actor: Actor, lead: BookedLead, bookingId: string): Promise<{ clientId: string; created: boolean }> {
  const clientId = await linkExistingClient(tx, actor, lead, bookingId);
  if (clientId) return { clientId, created: false };
  const values = {
    name: lead.name,
    phoneCountryCode: lead.phoneCountryCode,
    phoneNumber: lead.phoneNumber,
    phoneE164: lead.phoneE164,
    email: lead.email,
    cityId: lead.cityId,
    cityOther: lead.cityOther,
    ownerId: lead.ownerId ?? actor.id,
    createdById: actor.id,
  };
  const [created] = await tx.insert(clients).values(values).returning({ id: clients.id });
  await tx.update(leads).set({ clientId: created.id }).where(eq(leads.id, lead.id));
  await logClientLink(tx, actor, lead.id, created.id, "booking_created");
  await logClientActivity(tx, { clientId: created.id, actorId: actor.id, type: "created", data: { mode: "booking", leadId: lead.id, leadCode: lead.code, bookingId } });
  await auditClient(tx, actor, "client.create_from_booking", created.id, null, { ...values, leadId: lead.id, bookingId });
  await copyLeadPhonesToClient(tx, lead.id, created.id);
  await linkLeadBookings(tx, lead.id, created.id);
  return { clientId: created.id, created: true };
}
