import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTask, setTaskStatus } from "@/modules/tasks/commands";
import { listTasks, openTodos } from "@/modules/tasks/queries";
import type { Database } from "@/server/db";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, resetDb, seedFixture, type Fixture } from "../support/db";

const todo = (assigneeId: string, title: string, dueAt: string | null = null) => ({ title, type: "general", assigneeId, dueAt, leadId: null, bookingId: null, description: "" });

/** To-dos (owner, 14 Nov 2026): "general" tasks moved from Tasks to the To-dos page and My workplace. */
describe.skipIf(!hasTestDb)("Personal to-dos (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
  });

  it("an agent adds their own to-dos, soonest first; done ones leave the list", async () => {
    const later = await createTask(db, f.actors.agent1, todo(f.actors.agent1.id, "Send brochure", "2099-01-02T05:00:00Z"));
    await createTask(db, f.actors.agent1, todo(f.actors.agent1.id, "Call Mr Ali", "2099-01-01T05:00:00Z"));
    await createTask(db, f.actors.agent1, todo(f.actors.agent1.id, "Someday"));
    expect((await openTodos(db, f.actors.agent1)).rows.map((r) => r.title)).toEqual(["Call Mr Ali", "Send brochure", "Someday"]);
    await setTaskStatus(db, f.actors.agent1, later.taskId, { status: "done" });
    expect((await openTodos(db, f.actors.agent1)).rows.map((r) => r.title)).toEqual(["Call Mr Ali", "Someday"]);
    // Another agent sees none of them.
    expect((await openTodos(db, f.actors.agent2)).count).toBe(0);
  });

  it("an agent can't give a to-do to someone else; an Admin can give one to HR, who sees it", async () => {
    const refused = await createTask(db, f.actors.agent1, todo(f.actors.agent2.id, "Not yours")).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(AppError);
    await createTask(db, f.actors.superAdmin, todo(f.actors.hr.id, "Collect CNIC copies"));
    const forHr = await openTodos(db, f.actors.hr);
    expect(forHr.rows.map((r) => [r.title, r.creatorName])).toEqual([["Collect CNIC copies", "Super Admin"]]);
    // The giver sees it on their list too, marked as for HR.
    expect((await openTodos(db, f.actors.superAdmin)).rows.map((r) => r.assigneeName)).toEqual(["HR"]);
  });

  it("the Tasks screen lists printables only; the full list (API) still has every task", async () => {
    await createTask(db, f.actors.superAdmin, todo(f.actors.agent1.id, "A to-do"));
    expect((await listTasks(db, f.actors.superAdmin, {}, undefined, { printablesOnly: true })).rows).toEqual([]);
    expect((await listTasks(db, f.actors.superAdmin, {})).rows.map((r) => r.title)).toEqual(["A to-do"]);
  });
});
