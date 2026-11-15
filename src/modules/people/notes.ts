import { eq } from "drizzle-orm";
import { z } from "zod";
import { parseTask as parse } from "@/modules/tasks/support";
import type { Actor } from "@/server/auth/types";
import type { Database } from "@/server/db";
import { auditLogs, employeeNotes, users } from "@/server/db/schema";
import { forbidden, notFound } from "@/server/errors";
import { canViewProfiles } from "./profile";

/**
 * Private coaching notes on an employee's work profile (owner, 16 Nov 2026). Admins and Super Admins
 * write and read them; the employee never sees them. The author (or a Super Admin) can delete one.
 */
const noteSchema = z.object({ body: z.string().trim().min(1, "Write a note").max(2000, "Use at most 2,000 characters") }).strict();

export async function addEmployeeNote(db: Database, actor: Actor, userId: string, input: unknown) {
  if (!canViewProfiles(actor)) throw forbidden();
  const { body } = parse(noteSchema, input);
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw notFound("Person");
  if (userId === actor.id) throw forbidden("You can't keep notes on yourself.");
  const [person] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!person) throw notFound("Person");
  const [row] = await db.insert(employeeNotes).values({ userId, authorId: actor.id, body }).returning({ id: employeeNotes.id });
  await db.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: "people.note", entity: "user", entityId: userId, before: null, after: { noteId: row.id } });
  return { id: row.id };
}

export async function deleteEmployeeNote(db: Database, actor: Actor, id: string) {
  if (!canViewProfiles(actor)) throw forbidden();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Note");
  const [note] = await db.select().from(employeeNotes).where(eq(employeeNotes.id, id)).limit(1);
  if (!note) throw notFound("Note");
  if (note.authorId !== actor.id && actor.role !== "super_admin") throw forbidden("Only the note's author or a Super Admin can delete it.");
  await db.delete(employeeNotes).where(eq(employeeNotes.id, id));
  await db.insert(auditLogs).values({ actorId: actor.id, ip: actor.ip ?? null, action: "people.note_delete", entity: "user", entityId: note.userId, before: { body: note.body }, after: null });
  return { deleted: true };
}
