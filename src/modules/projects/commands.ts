import { and, eq, ne, sql } from "drizzle-orm";
import type { Database } from "@/server/db";
import { auditLogs, projects } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, notFound } from "@/server/errors";
import { parse } from "@/modules/clients/support";
import { isUniqueViolation, type DbOrTx } from "@/modules/leads/support";
import { assertCanProject } from "./policy";
import { createProjectSchema, dimensionsSchema, updateProjectSchema } from "./validation";

const NAME_TAKEN = "A project with this name already exists.";

function nameTaken() {
  return new AppError("CONFLICT", NAME_TAKEN, { fields: { name: NAME_TAKEN } });
}

const isNameViolation = (error: unknown) =>
  isUniqueViolation(error, "projects_name_lower_uq") || isUniqueViolation(error, "projects_name_unique");

async function assertNameFree(db: DbOrTx, name: string, exceptId?: string) {
  const [clash] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(sql`lower(${projects.name}) = lower(${name})`, exceptId ? ne(projects.id, exceptId) : undefined))
    .limit(1);
  if (clash) throw nameTaken();
}

async function auditProject(db: DbOrTx, actor: Actor, action: string, entityId: string, before: unknown, after: unknown) {
  await db.insert(auditLogs).values({ actorId: actor.id, action, entity: "project", entityId, before: before ?? null, after: after ?? null });
}

/** FR-060 create (super admin / admin). */
export async function createProject(db: Database, actor: Actor, input: unknown) {
  assertCanProject(actor, "manage");
  const data = parse(createProjectSchema, input);
  return db.transaction(async (tx) => {
    await assertNameFree(tx, data.name);
    const values = {
      name: data.name,
      type: data.type,
      developer: data.developer ?? null,
      city: data.city ?? null,
      address: data.address ?? null,
      description: data.description ?? null,
      status: data.status,
    };
    let created: { id: string };
    try {
      [created] = await tx.transaction((sp) => sp.insert(projects).values(values).returning({ id: projects.id }));
    } catch (error) {
      if (isNameViolation(error)) throw nameTaken();
      throw error;
    }
    await auditProject(tx, actor, "project.create", created.id, null, values);
    return { projectId: created.id };
  });
}

/** FR-060 edit, including activate / deactivate (super admin / admin). */
export async function updateProject(db: Database, actor: Actor, projectId: string, input: unknown) {
  assertCanProject(actor, "manage");
  const data = parse(updateProjectSchema, input);
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw notFound("Project");
  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).limit(1).for("update");
    if (!project) throw notFound("Project");

    const changes: Partial<typeof projects.$inferInsert> = {};
    if (data.name !== undefined) changes.name = data.name;
    if (data.type !== undefined) changes.type = data.type;
    if (data.status !== undefined) changes.status = data.status;
    for (const key of ["developer", "city", "address", "description"] as const) {
      if (key in data) changes[key] = data[key] ?? null;
    }

    const changed = Object.keys(changes).filter(
      (key) => String(changes[key as keyof typeof changes] ?? "") !== String(project[key as keyof typeof project] ?? ""),
    );
    if (changed.length === 0) return { changed: [] as string[] };
    if (changes.name !== undefined && changes.name !== project.name) await assertNameFree(tx, changes.name, projectId);

    try {
      await tx.transaction((sp) => sp.update(projects).set({ ...changes, updatedAt: new Date() }).where(eq(projects.id, projectId)));
    } catch (error) {
      if (isNameViolation(error)) throw nameTaken();
      throw error;
    }
    await auditProject(
      tx,
      actor,
      changed.includes("status") ? `project.${changes.status === "active" ? "activate" : "deactivate"}` : "project.update",
      projectId,
      Object.fromEntries(changed.map((k) => [k, project[k as keyof typeof project]])),
      Object.fromEntries(changed.map((k) => [k, changes[k as keyof typeof changes]])),
    );
    return { changed };
  });
}

/**
 * FR-061 per-project inventory dimensions (super admin / admin). Lists replace the stored ones;
 * existing units keep their values (they are re-checked only when edited).
 */
export async function updateProjectDimensions(db: Database, actor: Actor, projectId: string, input: unknown) {
  assertCanProject(actor, "manage");
  const data = parse(dimensionsSchema, input);
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw notFound("Project");
  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).limit(1).for("update");
    if (!project) throw notFound("Project");
    const next = { ...project.dimensionConfig, ...data };
    if (JSON.stringify(next) === JSON.stringify(project.dimensionConfig)) return { changed: false };
    await tx.update(projects).set({ dimensionConfig: next, updatedAt: new Date() }).where(eq(projects.id, projectId));
    await auditProject(tx, actor, "project.dimensions", projectId, project.dimensionConfig, next);
    return { changed: true };
  });
}
