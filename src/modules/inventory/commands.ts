import { and, eq, ne } from "drizzle-orm";
import { syncProposalsForUnit } from "@/modules/tasks/price-sync";
import type { Database } from "@/server/db";
import { auditLogs, bookings, projects, units, type ProjectDimensions } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, notFound } from "@/server/errors";
import { parse } from "@/modules/clients/support";
import { isUniqueViolation, type DbOrTx } from "@/modules/leads/support";
import { DIMENSION_FIELD, DIMENSION_KEYS, UNIT_STATUS_LABELS, type DimensionKey } from "./constants";
import { assertCanInventory } from "./policy";
import { transitionUnitStatus } from "./status";
import { createUnitSchema, statusChangeSchema, updateUnitSchema } from "./validation";

const UNIT_TAKEN = "This unit number already exists in the project.";

type DimensionField = (typeof DIMENSION_FIELD)[DimensionKey];

async function auditUnit(db: DbOrTx, actor: Actor, action: string, entityId: string, before: unknown, after: unknown) {
  await db.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action, entity: "unit", entityId, before: before ?? null, after: after ?? null });
}

/**
 * FR-061: when a project defines a list for a dimension, the unit value must be one of them
 * (matched ignoring case, stored in the configured spelling). An empty list allows free text.
 */
function applyDimensions(config: ProjectDimensions, values: Partial<Record<DimensionField, string | undefined>>) {
  const errors: Record<string, string> = {};
  const out: Partial<Record<DimensionField, string | undefined>> = { ...values };
  for (const key of DIMENSION_KEYS) {
    const field = DIMENSION_FIELD[key];
    const value = values[field];
    const allowed = config[key] ?? [];
    if (!value || allowed.length === 0) continue;
    const match = allowed.find((a) => a.toLowerCase() === value.toLowerCase());
    if (match) out[field] = match;
    else errors[field] = "Choose a value defined for this project";
  }
  if (Object.keys(errors).length) throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: errors });
  return out;
}

function unitTaken() {
  return new AppError("CONFLICT", UNIT_TAKEN, { fields: { unitNo: UNIT_TAKEN } });
}

/** FR-070 manual unit (super admin / admin). New units start Available (USER_FLOWS §4). */
export async function createUnit(db: Database, actor: Actor, input: unknown) {
  assertCanInventory(actor, "manage");
  const data = parse(createUnitSchema, input);
  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, data.projectId)).limit(1);
    if (!project) throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { projectId: "Choose a project" } });
    const dims = applyDimensions(project.dimensionConfig, data);
    const values = {
      projectId: data.projectId,
      unitNo: data.unitNo,
      floor: dims.floor ?? null,
      block: dims.block ?? null,
      saleModel: data.saleModel,
      areaSqft: data.areaSqft,
      basePrice: data.basePrice,
      nature: data.nature ?? null,
      category: dims.category ?? null,
      type: dims.type ?? null,
      bedrooms: data.bedrooms ?? null,
      premium: dims.premium ?? null,
      comment: data.comment ?? null,
      listedOn: data.listedOn ?? null,
      createdById: actor.id,
    };
    let created: { id: string };
    try {
      [created] = await tx.transaction((sp) => sp.insert(units).values(values).returning({ id: units.id }));
    } catch (error) {
      if (isUniqueViolation(error, "units_project_unit_no_uq")) throw unitTaken();
      throw error;
    }
    await auditUnit(tx, actor, "unit.create", created.id, null, { ...values, status: "available" });
    return { unitId: created.id };
  });
}

/** FR-070 edit (super admin / admin). Status is changed separately with a reason. */
export async function updateUnit(db: Database, actor: Actor, unitId: string, input: unknown) {
  assertCanInventory(actor, "manage");
  const data = parse(updateUnitSchema, input);
  if (!/^[0-9a-f-]{36}$/i.test(unitId)) throw notFound("Unit");
  return db.transaction(async (tx) => {
    const [unit] = await tx.select().from(units).where(eq(units.id, unitId)).limit(1).for("update");
    if (!unit) throw notFound("Unit");
    const [project] = await tx.select().from(projects).where(eq(projects.id, unit.projectId));

    const changes: Partial<typeof units.$inferInsert> = {};
    if (data.unitNo !== undefined) changes.unitNo = data.unitNo;
    if (data.saleModel !== undefined) changes.saleModel = data.saleModel;
    if (data.areaSqft !== undefined) changes.areaSqft = data.areaSqft;
    if (data.basePrice !== undefined) changes.basePrice = data.basePrice;
    for (const key of ["floor", "block", "nature", "category", "type", "premium", "comment", "listedOn", "bedrooms"] as const) {
      if (key in data) (changes as Record<string, unknown>)[key] = data[key] ?? null;
    }

    const changed = Object.keys(changes).filter(
      (key) => String(changes[key as keyof typeof changes] ?? "") !== String(unit[key as keyof typeof unit] ?? ""),
    );
    if (changed.length === 0) return { changed: [] as string[] };

    // Only values being changed are checked against the dimension lists, so older units stay editable.
    const dimChanges = Object.fromEntries(
      Object.values(DIMENSION_FIELD)
        .filter((f) => changed.includes(f))
        .map((f) => [f, (changes[f] as string | null) ?? undefined]),
    );
    Object.assign(changes, Object.fromEntries(Object.entries(applyDimensions(project.dimensionConfig, dimChanges)).map(([k, v]) => [k, v ?? null])));

    if (changes.saleModel === "whole" && unit.status === "partially_booked") {
      throw new AppError("BUSINESS_RULE", "A partially booked unit can't become a whole unit. Change its status first.");
    }
    try {
      await tx.transaction((sp) => sp.update(units).set({ ...changes, updatedAt: new Date() }).where(eq(units.id, unitId)));
    } catch (error) {
      if (isUniqueViolation(error, "units_project_unit_no_uq")) throw unitTaken();
      throw error;
    }
    await auditUnit(
      tx,
      actor,
      "unit.update",
      unitId,
      Object.fromEntries(changed.map((k) => [k, unit[k as keyof typeof unit]])),
      Object.fromEntries(changed.map((k) => [k, changes[k as keyof typeof changes]])),
    );
    // Q47: saved proposals follow the unit's price (and its floor, which sets the floor rate when the unit has no price).
    const proposalsUpdated = changed.includes("basePrice") || changed.includes("areaSqft") || changed.includes("floor") ? (await syncProposalsForUnit(tx, actor, unitId)).updated : 0;
    return proposalsUpdated ? { changed, proposalsUpdated } : { changed };
  });
}

/**
 * Admin status override with a reason (decision 29 Oct 2026), until Bookings drives status.
 * Uses the guarded transition, so a concurrent change made meanwhile is reported, not overwritten.
 */
export async function setUnitStatus(db: Database, actor: Actor, unitId: string, input: unknown) {
  assertCanInventory(actor, "manage");
  const { status, reason } = parse(statusChangeSchema, input);
  if (!/^[0-9a-f-]{36}$/i.test(unitId)) throw notFound("Unit");
  return db.transaction(async (tx) => {
    const [unit] = await tx.select().from(units).where(eq(units.id, unitId)).limit(1);
    if (!unit) throw notFound("Unit");
    if (unit.status === status) throw new AppError("BUSINESS_RULE", `The unit is already ${UNIT_STATUS_LABELS[status].toLowerCase()}.`);
    // A unit with an active booking is managed by that booking; an override would silently undo the reservation.
    const [active] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.unitId, unitId), ne(bookings.stage, "cancelled")))
      .limit(1);
    if (active) throw new AppError("BUSINESS_RULE", "This unit has an active booking. Change it through the booking (confirm or cancel).");
    if (status === "partially_booked" && unit.saleModel === "whole") {
      throw new AppError("BUSINESS_RULE", "Only SPU or 50% fractional units can be partially booked.", {
        fields: { status: "Only SPU or 50% fractional units can be partially booked" },
      });
    }
    await transitionUnitStatus(tx, { unitId, from: [unit.status], to: status, actorId: actor.id, ip: actor.ip ?? null, source: "manual", reason });
    return { from: unit.status, to: status };
  });
}
