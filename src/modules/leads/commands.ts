import { leadLink, notify, teamManagersOf } from "@/modules/notifications/service";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { businessToday } from "@/modules/bookings/today";
import type { Database } from "@/server/db";
import {
  approvals,
  followUps,
  leadActivities,
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
import { assertCan, canAccessLead, canAssignTo, canDo, leadScope } from "./policy";
import { assertStageChange, OPEN_BOOKING_MESSAGE, pickNextAssignee } from "./rules";
import { audit, hasOpenBooking, isUniqueViolation, loadAccessibleLead, logActivity, refreshNextFollowUp, teamMemberIds, touchValues, type Tx } from "./support";
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

/**
 * The teams this manager runs now, read inside the transaction (`actor.managedTeamIds` dates from
 * before it) and share-locked until it ends. Team changes lock the team row, so an assignment and a
 * change to the team's manager, members or active flag run one after the other. They never lock
 * leads, so taking this after the lead's lock can't deadlock.
 */
async function lockManagedTeams(tx: Tx, actor: Actor) {
  return tx.select({ id: teams.id, isActive: teams.isActive }).from(teams).where(eq(teams.managerId, actor.id)).orderBy(asc(teams.id)).for("share");
}

/** Validates a prospective owner: active agent/manager the actor is allowed to assign to. */
async function assertAssignable(tx: Tx, actor: Actor, ownerId: string) {
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
  const members = leadScope(actor.role) === "team" ? await teamMemberIds(tx, { ...actor, managedTeamIds: (await lockManagedTeams(tx, actor)).map((t) => t.id) }) : [];
  if (!canAssignTo(actor, ownerId, members)) throw forbidden("You cannot assign leads to that user.");
}

/**
 * The manager's rotation continues from the last of these agents to get a rotated lead in the
 * project. The project's single pointer can't serve here: another team's rotation moves it, which
 * would send this team back to its first agent every time.
 */
async function lastRotatedTo(tx: Tx, projectId: string, agentIds: string[]) {
  const ownerId = sql<string>`${leadActivities.data}->>'ownerId'`;
  const [row] = await tx
    .select({ ownerId })
    .from(leadActivities)
    .innerJoin(leads, eq(leads.id, leadActivities.leadId))
    .where(and(eq(leads.projectId, projectId), eq(leadActivities.type, "assignment"), sql`${leadActivities.data}->>'mode' = 'rotation'`, inArray(ownerId, agentIds)))
    .orderBy(desc(leadActivities.createdAt))
    .limit(1);
  return row?.ownerId ?? null;
}

/**
 * Round-robin owner for a project among active agents in active teams (Q2). Agents on approved
 * leave today (Pakistan date) are skipped (questionnaire Q19). A manager's rotation stays inside the
 * active teams they run, like their manual assignment (F-15); admins rotate across all teams.
 */
async function rotateOwner(tx: Tx, actor: Actor, projectId: string, now = new Date()): Promise<string | null> {
  const today = businessToday(now);
  const teamIds = leadScope(actor.role) === "team" ? (await lockManagedTeams(tx, actor)).filter((t) => t.isActive).map((t) => t.id) : null;
  if (teamIds?.length === 0) return null;
  const eligible = await tx
    .selectDistinct({ id: users.id, name: users.name })
    .from(users)
    .innerJoin(teamMembers, eq(teamMembers.userId, users.id))
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(
      and(
        eq(users.role, "agent"),
        eq(users.status, "active"),
        eq(teams.isActive, true),
        teamIds ? inArray(teams.id, teamIds) : undefined,
        sql`not exists (select 1 from leave_requests lr where lr.user_id = ${users.id} and lr.status in ('approved', 'cancel_requested') and lr.start_date <= ${today} and lr.end_date >= ${today})`,
      ),
    )
    .orderBy(asc(users.name), asc(users.id));
  if (eligible.length === 0) return null;

  await tx.insert(rotationState).values({ projectId }).onConflictDoNothing();
  const [state] = await tx
    .select()
    .from(rotationState)
    .where(eq(rotationState.projectId, projectId))
    .for("update");
  const eligibleIds = eligible.map((u) => u.id);
  const next = pickNextAssignee(eligibleIds, teamIds ? await lastRotatedTo(tx, projectId, eligibleIds) : (state?.lastUserId ?? null));
  await tx.update(rotationState).set({ lastUserId: next, updatedAt: new Date() }).where(eq(rotationState.projectId, projectId));
  return next;
}

/**
 * Duplicate phone rule (LEADS_MODULE_PLAN.md Q1), shared by create and edit: the earliest lead in the
 * same project with the same normalized number that is not deleted and is not itself a flagged
 * duplicate. `exceptLeadId` leaves out the lead being edited.
 */
async function findPhoneMatch(tx: Tx, projectId: string, e164: string, exceptLeadId?: string) {
  const [existing] = await tx
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.projectId, projectId),
        eq(leads.phoneE164, e164),
        isNull(leads.deletedAt),
        isNull(leads.duplicateOfId),
        exceptLeadId ? ne(leads.id, exceptLeadId) : undefined,
      ),
    )
    .orderBy(asc(leads.createdAt))
    .limit(1);
  return existing ?? null;
}

/**
 * Serializes concurrent claims of one number in one project (create and edit) until the transaction
 * ends, so two requests can't both pass the duplicate check. A unique index can't be used: flagged
 * duplicates and shared-phone groups (FR-032) legitimately share a number.
 */
async function lockPhone(tx: Tx, projectId: string, e164: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`lead-phone:${projectId}:${e164}`}, 0))`);
}

const DUPLICATE_PHONE_MESSAGE = "A lead with this phone number already exists in this project.";

function duplicatePhoneError(existing: typeof leads.$inferSelect, visible: boolean, field?: string) {
  return new AppError("CONFLICT", DUPLICATE_PHONE_MESSAGE, {
    details: visible ? { existingLeadId: existing.id, existingCode: existing.code, existingName: existing.name } : {},
    ...(field ? { fields: { [field]: visible ? `Already used by lead ${existing.code}` : "Already used by another lead in this project" } } : {}),
  });
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
    await lockPhone(tx, data.projectId, phone.e164);
    const existing = await findPhoneMatch(tx, data.projectId, phone.e164);
    const existingVisible = existing ? canAccessLead(actor, existing.ownerId, members) : false;

    if (existing && data.onDuplicate === "reject") throw duplicatePhoneError(existing, existingVisible);

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
      if (existing.ownerId) {
        await notify(
          tx,
          [{ userId: existing.ownerId, type: "lead_regenerated", title: `Re-inquiry · ${existing.name}`, body: `Lead ${existing.code} enquired again.`, link: leadLink(existing.id), dedupeKey: `lead_regenerated:${existing.id}:${now.toISOString()}` }],
          actor.id,
        );
      }
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
      await assertAssignable(tx, actor, data.ownerId);
      ownerId = data.ownerId;
    } else {
      ownerId = await rotateOwner(tx, actor, data.projectId);
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
      // Clock time, not the default transaction start: written under the rotation lock, so rotations sort in the order they ran (lastRotatedTo).
      await logActivity(tx, { leadId: created.id, actorId: null, type: "assignment", data: { mode: "rotation", ownerId }, createdAt: sql`clock_timestamp()` });
    }
    if (data.note) {
      await logActivity(tx, { leadId: created.id, actorId: actor.id, type: "note", body: data.note });
    }
    await audit(tx, actor, "lead.create", created.id, null, { ...values, code: created.code });
    if (ownerId) {
      await notify(
        tx,
        [{ userId: ownerId, type: "lead_assigned", title: `Lead assigned to you · ${data.name}`, body: rotated ? `Lead ${created.code} · auto-assigned (rotation)` : `Lead ${created.code} · assigned by ${actor.name}`, link: leadLink(created.id), dedupeKey: `lead_assigned:${created.id}:created` }],
        actor.id,
      );
    }
    return { outcome: "created", leadId: created.id, code: created.code };
  });
}

export async function updateLead(db: Database, actor: Actor, leadId: string, input: unknown) {
  assertCan(actor, "edit");
  const data = parse(updateLeadSchema, input);
  const phoneOf = (lead: typeof leads.$inferSelect) => phoneOrThrow(data.phoneCountryCode ?? lead.phoneCountryCode, data.phoneNumber ?? lead.phoneNumber);
  const phoneEdited = data.phoneNumber !== undefined || data.phoneCountryCode !== undefined;
  return db.transaction(async (tx) => {
    // F-3: a changed number is checked like a new lead's. The number lock is taken before the lead's
    // row lock (the order createLead uses when it regenerates an existing lead), so they can't deadlock.
    if (phoneEdited) {
      const { lead: current } = await loadAccessibleLead(tx, actor, leadId);
      const target = phoneOf(current);
      if (target.e164 !== current.phoneE164) await lockPhone(tx, current.projectId, target.e164);
    }
    const { lead, members } = await loadAccessibleLead(tx, actor, leadId, true);
    const changes: Partial<typeof leads.$inferInsert> = {};
    if (data.name !== undefined) changes.name = data.name;
    if (phoneEdited) {
      const phone = phoneOf(lead);
      if (phone.e164 !== lead.phoneE164) {
        await lockPhone(tx, lead.projectId, phone.e164); // no-op if already held; covers a change made meanwhile
        const existing = await findPhoneMatch(tx, lead.projectId, phone.e164, lead.id);
        if (existing) throw duplicatePhoneError(existing, canAccessLead(actor, existing.ownerId, members), "phoneNumber");
      }
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
    assertStageChange(lead.stage, stage, await hasOpenBooking(tx, leadId));
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
    const { lead } = await loadAccessibleLead(tx, actor, leadId, true);
    if (lead.ownerId === ownerId) throw new AppError("BUSINESS_RULE", "The lead is already assigned to that user.");
    await assertAssignable(tx, actor, ownerId);
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
    await notify(
      tx,
      [{ userId: ownerId, type: "lead_assigned", title: `Lead assigned to you · ${lead.name}`, body: `Lead ${lead.code} · assigned by ${actor.name}`, link: leadLink(leadId), dedupeKey: `lead_assigned:${leadId}:${now.toISOString()}` }],
      actor.id,
    );
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
    await audit(tx, actor, "lead.note", leadId, { latestComment: lead.latestComment }, { latestComment: body });
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
    const assigneeId = lead.ownerId ?? actor.id;
    const [followUp] = await tx
      .insert(followUps)
      .values({ leadId, assigneeId, dueAt, note: note ?? null, createdById: actor.id })
      .returning({ id: followUps.id });
    await audit(tx, actor, "lead.follow_up", leadId, null, { followUpId: followUp.id, dueAt: dueAt.toISOString(), assigneeId, note: note ?? null, status: "pending" });
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
    await audit(tx, actor, "lead.follow_up_done", lead.id, { followUpId, status: followUp.status }, { followUpId, status: "done", dueAt: followUp.dueAt.toISOString(), doneAt: now.toISOString() });
  });
}

/** A person's own favourite flag. Audited only when it actually changes (a repeat is a no-op). */
export async function setFavorite(db: Database, actor: Actor, leadId: string, favorite: boolean) {
  assertCan(actor, "view");
  return db.transaction(async (tx) => {
    await loadAccessibleLead(tx, actor, leadId);
    const changed = favorite
      ? await tx.insert(leadFavorites).values({ userId: actor.id, leadId }).onConflictDoNothing().returning({ leadId: leadFavorites.leadId })
      : await tx.delete(leadFavorites).where(and(eq(leadFavorites.userId, actor.id), eq(leadFavorites.leadId, leadId))).returning({ leadId: leadFavorites.leadId });
    if (changed.length) await audit(tx, actor, favorite ? "lead.favorite" : "lead.unfavorite", leadId, { favorite: !favorite }, { favorite });
  });
}

export async function addReview(db: Database, actor: Actor, leadId: string, input: unknown) {
  assertCan(actor, "review");
  const { body } = parse(reviewSchema, input);
  return db.transaction(async (tx) => {
    await loadAccessibleLead(tx, actor, leadId);
    const [review] = await tx.insert(leadReviews).values({ leadId, reviewerId: actor.id, body }).returning({ id: leadReviews.id });
    await logActivity(tx, { leadId, actorId: actor.id, type: "review", body });
    await audit(tx, actor, "lead.review", leadId, null, { reviewId: review.id, body });
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
    // Checked for agents' requests too: an approval could otherwise only be refused later.
    if (await hasOpenBooking(tx, leadId)) throw new AppError("BUSINESS_RULE", OPEN_BOOKING_MESSAGE);
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

    let approvalId: string;
    try {
      [{ id: approvalId }] = await tx.transaction((sp) =>
        sp.insert(approvals).values({ type: "lead_lost", leadId, requestedById: actor.id, lostReasonId, note: note ?? null }).returning({ id: approvals.id }),
      );
    } catch (error) {
      if (isUniqueViolation(error, "approvals_one_pending_per_lead_uq")) {
        throw new AppError("CONFLICT", "A lost request for this lead is already waiting for approval.");
      }
      throw error;
    }
    await logActivity(tx, { leadId, actorId: actor.id, type: "lost_requested", body: note ?? null, data: { reason: reason.name } });
    await audit(tx, actor, "lead.lost_request", leadId, null, { lostReasonId });
    const managers = await teamManagersOf(tx, lead.ownerId ?? actor.id);
    await notify(
      tx,
      managers.map((userId) => ({
        userId,
        type: "lost_requested" as const,
        title: `Lost request · ${lead.name}`,
        body: `${actor.name} asked to mark lead ${lead.code} lost (${reason.name}).`,
        link: leadLink(leadId),
        dedupeKey: `lost_requested:${approvalId}`,
      })),
      actor.id,
    );
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
    // A booking opened after the request: approving would contradict it. The request stays pending
    // (it can still be rejected) until the booking is cancelled.
    if (approve && lead.stage !== "lost_lead" && lead.stage !== "booked" && (await hasOpenBooking(tx, lead.id))) {
      throw new AppError("BUSINESS_RULE", OPEN_BOOKING_MESSAGE);
    }
    const now = new Date();
    await tx
      .update(approvals)
      .set({ status: approve ? "approved" : "rejected", decidedById: actor.id, decidedAt: now, decisionComment: comment ?? null })
      .where(eq(approvals.id, approvalId));

    const moved = approve && lead.stage !== "lost_lead" && lead.stage !== "booked";
    if (moved) {
      await tx
        .update(leads)
        .set({ stage: "lost_lead", stageChangedAt: now, lostReasonId: request.lostReasonId, updatedAt: now })
        .where(eq(leads.id, lead.id));
      const [reason] = await tx.select({ name: lostReasons.name }).from(lostReasons).where(eq(lostReasons.id, request.lostReasonId!)).limit(1);
      await logActivity(tx, {
        leadId: lead.id,
        actorId: actor.id,
        type: "stage_change",
        data: { from: lead.stage, to: "lost_lead", fromLabel: STAGE_LABELS[lead.stage], toLabel: STAGE_LABELS.lost_lead, reason: reason?.name ?? null },
      });
    }
    await logActivity(tx, {
      leadId: lead.id,
      actorId: actor.id,
      type: "lost_decided",
      body: comment ?? null,
      data: { approved: approve, from: lead.stage },
    });
    await audit(tx, actor, approve ? "lead.lost_approved" : "lead.lost_rejected", lead.id, { stage: lead.stage }, { approvalId, stage: moved ? "lost_lead" : lead.stage });
    if (!approve) {
      await notify(
        tx,
        [{ userId: request.requestedById, type: "lost_rejected", title: `Lost request rejected · ${lead.name}`, body: comment ? `${actor.name}: ${comment}` : `Rejected by ${actor.name}. The lead stays in its stage.`, link: leadLink(lead.id), dedupeKey: `lost_rejected:${approvalId}` }],
        actor.id,
      );
    }
  });
}