import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "@/server/db";
import {
  approvals,
  followUps,
  leadFavorites,
  leadReviews,
  leads,
  lostReasons,
  projects,
  rotationState,
  teamMembers,
  teams,
  users,
} from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, forbidden, notFound } from "@/server/errors";
import { generateLeadCode } from "./code";
import { STAGE_LABELS } from "./constants";
import { normalizePhone } from "./phone";
import { assertCan, canAccessLead, canAssignTo, canDo } from "./policy";
import { assertStageChange, pickNextAssignee } from "./rules";
import {
  audit,
  isUniqueViolation,
  loadAccessibleLead,
  logActivity,
  refreshNextFollowUp,
  teamMemberIds,
  touchValues,
  type Tx,
} from "./support";
import {
  assignSchema,
  createLeadSchema,
  decisionSchema,
  fieldErrors,
  followUpSchema,
  lostSchema,
  noteSchema,
  reviewSchema,
  stageChangeSchema,
  updateLeadSchema,
} from "./validation";
import type { z } from "zod";

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: fieldErrors(result.error) });
  }
  return result.data;
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

/** Validates a prospective owner: active agent/manager the actor is allowed to assign to. */
async function assertAssignable(tx: Tx, actor: Actor, ownerId: string, members: string[]) {
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
  if (!canAssignTo(actor, ownerId, members)) throw forbidden("You cannot assign leads to that user.");
}

/** Round-robin owner for a project among active agents in active teams (Q2). */
async function rotateOwner(tx: Tx, projectId: string): Promise<string | null> {
  const eligible = await tx
    .selectDistinct({ id: users.id, name: users.name })
    .from(users)
    .innerJoin(teamMembers, eq(teamMembers.userId, users.id))
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(users.role, "agent"), eq(users.status, "active"), eq(teams.isActive, true)))
    .orderBy(asc(users.name), asc(users.id));
  if (eligible.length === 0) return null;

  await tx.insert(rotationState).values({ projectId }).onConflictDoNothing();
  const [state] = await tx
    .select()
    .from(rotationState)
    .where(eq(rotationState.projectId, projectId))
    .for("update");
  const next = pickNextAssignee(
    eligible.map((u) => u.id),
    state?.lastUserId ?? null,
  );
  await tx.update(rotationState).set({ lastUserId: next, updatedAt: new Date() }).where(eq(rotationState.projectId, projectId));
  return next;
}

export type CreateLeadOutcome =
  | { outcome: "created"; leadId: string; code: string }
  | { outcome: "regenerated"; leadId: string | null; code: string | null };

export async function createLead(db: Database, actor: Actor, input: unknown): Promise<CreateLeadOutcome> {
  assertCan(actor, "create");
  const data = parse(createLeadSchema, input);
  const phone = phoneOrThrow(data.phoneCountryCode, data.phoneNumber);

  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, data.projectId)).limit(1);
    if (!project || project.status !== "active") {
      throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { projectId: "Choose an active project" } });
    }
    const members = await teamMemberIds(tx, actor);
    const now = new Date();

    // Duplicate / re-inquiry handling (LEADS_MODULE_PLAN.md Q1).
    const [existing] = await tx
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.projectId, data.projectId),
          eq(leads.phoneE164, phone.e164),
          isNull(leads.deletedAt),
          isNull(leads.duplicateOfId),
        ),
      )
      .orderBy(asc(leads.createdAt))
      .limit(1);
    const existingVisible = existing ? canAccessLead(actor, existing.ownerId, members) : false;

    if (existing && data.onDuplicate === "reject") {
      throw new AppError("CONFLICT", "A lead with this phone number already exists in this project.", {
        details: existingVisible
          ? { existingLeadId: existing.id, existingCode: existing.code, existingName: existing.name }
          : {},
      });
    }

    if (existing && data.onDuplicate === "regenerate") {
      await tx
        .update(leads)
        .set({ isRegenerated: true, regeneratedAt: now, updatedAt: now })
        .where(eq(leads.id, existing.id));
      await logActivity(tx, {
        leadId: existing.id,
        actorId: actor.id,
        type: "regenerated",
        body: data.note ?? null,
        data: { source: "manual", by: actor.name },
      });
      await audit(tx, actor, "lead.regenerated", existing.id, null, { regeneratedAt: now });
      return {
        outcome: "regenerated",
        leadId: existingVisible ? existing.id : null,
        code: existingVisible ? existing.code : null,
      };
    }

    // Owner: agents own what they create; managers/admins may pick; otherwise rotation.
    let ownerId: string | null;
    let rotated = false;
    if (actor.role === "agent") {
      ownerId = actor.id;
    } else if (data.ownerId) {
      await assertAssignable(tx, actor, data.ownerId, members);
      ownerId = data.ownerId;
    } else {
      ownerId = await rotateOwner(tx, data.projectId);
      rotated = true;
      if (!ownerId && actor.role === "manager") ownerId = actor.id;
    }

    const values = {
      projectId: data.projectId,
      ownerId,
      name: data.name,
      phoneCountryCode: phone.countryCode,
      phoneNumber: phone.national,
      phoneE164: phone.e164,
      email: data.email ?? null,
      cityId: data.cityId ?? null,
      gender: data.gender ?? null,
      sourceId: data.sourceId,
      budgetRangeId: data.budgetRangeId ?? null,
      desiredSize: data.desiredSize ?? null,
      priority: data.priority,
      duplicateOfId: existing && data.onDuplicate === "duplicate" ? existing.id : null,
      latestComment: data.note ?? null,
      firstTouchAt: data.note ? now : null,
      lastActivityAt: now,
      createdById: actor.id,
    };

    let created: { id: string; code: string } | undefined;
    for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
      try {
        // Nested transaction = savepoint, so a code collision doesn't abort the outer transaction.
        [created] = await tx.transaction((sp) =>
          sp.insert(leads).values({ ...values, code: generateLeadCode() }).returning({ id: leads.id, code: leads.code }),
        );
      } catch (error) {
        if (!isUniqueViolation(error, "leads_code_uq")) throw error;
      }
    }
    if (!created) throw new Error("Could not generate a unique lead code.");

    await logActivity(tx, {
      leadId: created.id,
      actorId: actor.id,
      type: "created",
      data: { duplicateOf: values.duplicateOfId ? existing?.code ?? null : null },
    });
    if (rotated && ownerId) {
      await logActivity(tx, { leadId: created.id, actorId: null, type: "assignment", data: { mode: "rotation", ownerId } });
    }
    if (data.note) {
      await logActivity(tx, { leadId: created.id, actorId: actor.id, type: "note", body: data.note });
    }
    await audit(tx, actor, "lead.create", created.id, null, { ...values, code: created.code });
    return { outcome: "created", leadId: created.id, code: created.code };
  });
}

export async function updateLead(db: Database, actor: Actor, leadId: string, input: unknown) {
  assertCan(actor, "edit");
  const data = parse(updateLeadSchema, input);
  return db.transaction(async (tx) => {
    const { lead } = await loadAccessibleLead(tx, actor, leadId, true);
    const changes: Partial<typeof leads.$inferInsert> = {};
    if (data.name !== undefined) changes.name = data.name;
    if (data.phoneNumber !== undefined || data.phoneCountryCode !== undefined) {
      const phone = phoneOrThrow(data.phoneCountryCode ?? lead.phoneCountryCode, data.phoneNumber ?? lead.phoneNumber);
      changes.phoneCountryCode = phone.countryCode;
      changes.phoneNumber = phone.national;
      changes.phoneE164 = phone.e164;
    }
    if ("email" in data) changes.email = data.email ?? null;
    if ("cityId" in data) changes.cityId = data.cityId ?? null;
    if ("gender" in data) changes.gender = data.gender ?? null;
    if (data.sourceId !== undefined) changes.sourceId = data.sourceId;
    if ("budgetRangeId" in data) changes.budgetRangeId = data.budgetRangeId ?? null;
    if ("desiredSize" in data) changes.desiredSize = data.desiredSize ?? null;
    if (data.priority !== undefined) changes.priority = data.priority;

    const changed = Object.keys(changes).filter(
      (key) => String(changes[key as keyof typeof changes] ?? "") !== String(lead[key as keyof typeof lead] ?? ""),
    );
    if (changed.length === 0) return { changed: [] as string[] };

    const now = new Date();
    await tx.update(leads).set({ ...changes, updatedAt: now }).where(eq(leads.id, leadId));
    await logActivity(tx, { leadId, actorId: actor.id, type: "update", data: { fields: changed } });
    await audit(
      tx,
      actor,
      "lead.update",
      leadId,
      Object.fromEntries(changed.map((k) => [k, lead[k as keyof typeof lead]])),
      Object.fromEntries(changed.map((k) => [k, changes[k as keyof typeof changes]])),
    );
    return { changed };
  });
}

export async function changeStage(db: Database, actor: Actor, leadId: string, input: unknown) {
  assertCan(actor, "edit");
  const { stage } = parse(stageChangeSchema, input);
  return db.transaction(async (tx) => {
    const { lead } = await loadAccessibleLead(tx, actor, leadId, true);
    assertStageChange(lead.stage, stage);
    const now = new Date();
    await tx
      .update(leads)
      .set({ stage, stageChangedAt: now, ...touchValues(lead, now) })
      .where(eq(leads.id, leadId));
    await logActivity(tx, {
      leadId,
      actorId: actor.id,
      type: "stage_change",
      data: { from: lead.stage, to: stage, fromLabel: STAGE_LABELS[lead.stage], toLabel: STAGE_LABELS[stage] },
    });
    await audit(tx, actor, "lead.stage", leadId, { stage: lead.stage }, { stage });
    return { from: lead.stage, to: stage };
  });
}

export async function assignLead(db: Database, actor: Actor, leadId: string, input: unknown) {
  assertCan(actor, "assign");
  const { ownerId } = parse(assignSchema, input);
  return db.transaction(async (tx) => {
    const { lead, members } = await loadAccessibleLead(tx, actor, leadId, true);
    if (lead.ownerId === ownerId) throw new AppError("BUSINESS_RULE", "The lead is already assigned to that user.");
    await assertAssignable(tx, actor, ownerId, members);
    const now = new Date();
    await tx.update(leads).set({ ownerId, updatedAt: now }).where(eq(leads.id, leadId));
    await tx
      .update(followUps)
      .set({ assigneeId: ownerId })
      .where(and(eq(followUps.leadId, leadId), eq(followUps.status, "pending")));
    await logActivity(tx, {
      leadId,
      actorId: actor.id,
      type: "assignment",
      data: { mode: "manual", from: lead.ownerId, ownerId },
    });
    await audit(tx, actor, "lead.assign", leadId, { ownerId: lead.ownerId }, { ownerId });
  });
}

export async function addNote(db: Database, actor: Actor, leadId: string, input: unknown) {
  assertCan(actor, "edit");
  const { body } = parse(noteSchema, input);
  return db.transaction(async (tx) => {
    const { lead } = await loadAccessibleLead(tx, actor, leadId, true);
    const now = new Date();
    await logActivity(tx, { leadId, actorId: actor.id, type: "note", body });
    await tx
      .update(leads)
      .set({ latestComment: body, ...touchValues(lead, now) })
      .where(eq(leads.id, leadId));
  });
}

export async function scheduleFollowUp(db: Database, actor: Actor, leadId: string, input: unknown, now = new Date()) {
  assertCan(actor, "edit");
  const { dueAt, note } = parse(followUpSchema, input);
  if (dueAt.getTime() < now.getTime() - 60_000) {
    throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { dueAt: "Pick a time in the future" } });
  }
  return db.transaction(async (tx) => {
    const { lead } = await loadAccessibleLead(tx, actor, leadId, true);
    if (lead.stage === "lost_lead" || lead.stage === "booked") {
      throw new AppError("BUSINESS_RULE", "Follow-ups cannot be scheduled on closed leads.");
    }
    const [followUp] = await tx
      .insert(followUps)
      .values({ leadId, assigneeId: lead.ownerId ?? actor.id, dueAt, note: note ?? null, createdById: actor.id })
      .returning({ id: followUps.id });
    await tx.update(leads).set(touchValues(lead, now)).where(eq(leads.id, leadId));
    await refreshNextFollowUp(tx, leadId);
    await logActivity(tx, {
      leadId,
      actorId: actor.id,
      type: "follow_up_scheduled",
      body: note ?? null,
      data: { followUpId: followUp.id, dueAt: dueAt.toISOString() },
    });
    return followUp;
  });
}

export async function completeFollowUp(db: Database, actor: Actor, followUpId: string) {
  assertCan(actor, "edit");
  if (!/^[0-9a-f-]{36}$/i.test(followUpId)) throw notFound("Follow-up");
  return db.transaction(async (tx) => {
    const [followUp] = await tx.select().from(followUps).where(eq(followUps.id, followUpId)).limit(1).for("update");
    if (!followUp) throw notFound("Follow-up");
    const { lead } = await loadAccessibleLead(tx, actor, followUp.leadId, true);
    if (followUp.status !== "pending") throw new AppError("BUSINESS_RULE", "This follow-up is already closed.");
    const now = new Date();
    await tx
      .update(followUps)
      .set({ status: "done", doneAt: now, doneById: actor.id })
      .where(eq(followUps.id, followUpId));
    await tx.update(leads).set(touchValues(lead, now)).where(eq(leads.id, lead.id));
    await refreshNextFollowUp(tx, lead.id);
    await logActivity(tx, {
      leadId: lead.id,
      actorId: actor.id,
      type: "follow_up_done",
      data: { followUpId, dueAt: followUp.dueAt.toISOString() },
    });
  });
}

export async function setFavorite(db: Database, actor: Actor, leadId: string, favorite: boolean) {
  assertCan(actor, "view");
  await loadAccessibleLead(db, actor, leadId);
  if (favorite) {
    await db.insert(leadFavorites).values({ userId: actor.id, leadId }).onConflictDoNothing();
  } else {
    await db.delete(leadFavorites).where(and(eq(leadFavorites.userId, actor.id), eq(leadFavorites.leadId, leadId)));
  }
}

export async function addReview(db: Database, actor: Actor, leadId: string, input: unknown) {
  assertCan(actor, "review");
  const { body } = parse(reviewSchema, input);
  return db.transaction(async (tx) => {
    await loadAccessibleLead(tx, actor, leadId);
    await tx.insert(leadReviews).values({ leadId, reviewerId: actor.id, body });
    await logActivity(tx, { leadId, actorId: actor.id, type: "review", body });
  });
}

async function assertLostReason(tx: Tx, lostReasonId: string) {
  const [reason] = await tx.select().from(lostReasons).where(eq(lostReasons.id, lostReasonId)).limit(1);
  if (!reason || !reason.isActive) {
    throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { lostReasonId: "Choose a lost reason" } });
  }
  return reason;
}

/** Managers/admins mark lost directly; agents create a pending approval (FR-035). */
export async function markLost(db: Database, actor: Actor, leadId: string, input: unknown) {
  if (!canDo(actor, "markLostDirect") && !canDo(actor, "requestLost")) throw forbidden();
  const { lostReasonId, note } = parse(lostSchema, input);
  return db.transaction(async (tx) => {
    const { lead } = await loadAccessibleLead(tx, actor, leadId, true);
    if (lead.stage === "lost_lead") throw new AppError("BUSINESS_RULE", "The lead is already lost.");
    if (lead.stage === "booked") throw new AppError("BUSINESS_RULE", "Booked leads are managed from their booking.");
    const reason = await assertLostReason(tx, lostReasonId);
    const now = new Date();

    if (canDo(actor, "markLostDirect")) {
      await tx
        .update(leads)
        .set({ stage: "lost_lead", stageChangedAt: now, lostReasonId, ...touchValues(lead, now) })
        .where(eq(leads.id, leadId));
      await logActivity(tx, {
        leadId,
        actorId: actor.id,
        type: "stage_change",
        body: note ?? null,
        data: { from: lead.stage, to: "lost_lead", fromLabel: STAGE_LABELS[lead.stage], toLabel: STAGE_LABELS.lost_lead, reason: reason.name },
      });
      await audit(tx, actor, "lead.lost", leadId, { stage: lead.stage }, { stage: "lost_lead", lostReasonId });
      return { status: "lost" as const };
    }

    try {
      await tx.transaction((sp) =>
        sp.insert(approvals).values({ type: "lead_lost", leadId, requestedById: actor.id, lostReasonId, note: note ?? null }),
      );
    } catch (error) {
      if (isUniqueViolation(error, "approvals_one_pending_per_lead_uq")) {
        throw new AppError("CONFLICT", "A lost request for this lead is already waiting for approval.");
      }
      throw error;
    }
    await logActivity(tx, { leadId, actorId: actor.id, type: "lost_requested", body: note ?? null, data: { reason: reason.name } });
    await audit(tx, actor, "lead.lost_request", leadId, null, { lostReasonId });
    return { status: "pending_approval" as const };
  });
}

export async function decideLostRequest(db: Database, actor: Actor, approvalId: string, input: unknown) {
  assertCan(actor, "decideLost");
  const { approve, comment } = parse(decisionSchema, input);
  if (!/^[0-9a-f-]{36}$/i.test(approvalId)) throw notFound("Request");
  return db.transaction(async (tx) => {
    const [request] = await tx.select().from(approvals).where(eq(approvals.id, approvalId)).limit(1).for("update");
    if (!request) throw notFound("Request");
    const { lead } = await loadAccessibleLead(tx, actor, request.leadId, true);
    if (request.status !== "pending") throw new AppError("BUSINESS_RULE", "This request has already been decided.");
    const now = new Date();
    await tx
      .update(approvals)
      .set({ status: approve ? "approved" : "rejected", decidedById: actor.id, decidedAt: now, decisionComment: comment ?? null })
      .where(eq(approvals.id, approvalId));

    if (approve && lead.stage !== "lost_lead" && lead.stage !== "booked") {
      await tx
        .update(leads)
        .set({ stage: "lost_lead", stageChangedAt: now, lostReasonId: request.lostReasonId, updatedAt: now })
        .where(eq(leads.id, lead.id));
    }
    await logActivity(tx, {
      leadId: lead.id,
      actorId: actor.id,
      type: "lost_decided",
      body: comment ?? null,
      data: { approved: approve, from: lead.stage },
    });
    await audit(tx, actor, approve ? "lead.lost_approved" : "lead.lost_rejected", lead.id, { stage: lead.stage }, { approvalId });
  });
}