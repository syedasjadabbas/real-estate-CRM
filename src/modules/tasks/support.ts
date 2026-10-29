import { eq } from "drizzle-orm";
import type { z } from "zod";
import { tasks } from "@/server/db/schema";
import type { Actor } from "@/server/auth/types";
import { AppError, notFound } from "@/server/errors";
import { teamMemberIds, type DbOrTx } from "@/modules/leads/support";
import { canAccessTask } from "./policy";

/** Zod parse with full field paths ("proposal.discountPct", "rows.3.amount") so nested errors land on their field. */
export function parseTask<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) fields[issue.path.length ? issue.path.join(".") : "form"] ??= issue.message;
    throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields });
  }
  return result.data;
}

export const taskFieldError = (field: string, message: string) => new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fields: { [field]: message } });

/** Loads a task the actor may see; 404 otherwise (no existence leak). */
export async function loadAccessibleTask(db: DbOrTx, actor: Actor, taskId: string, forUpdate = false) {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw notFound("Task");
  const query = db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  const [task] = forUpdate ? await query.for("update") : await query;
  if (!task) throw notFound("Task");
  const members = await teamMemberIds(db, actor);
  if (!canAccessTask(actor, task, members)) throw notFound("Task");
  return { task, members };
}
