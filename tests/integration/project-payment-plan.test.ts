import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bookingFormOptions } from "@/modules/bookings/queries";
import { updateProjectPaymentPlan } from "@/modules/projects/commands";
import { projects } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, resetDb, seedFixture, type Fixture } from "../support/db";

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
};
const plan = { downPaymentPct: "35", installmentCount: "36", everyMonths: "1", possessionPct: "10", balloonCount: "2", balloonPct: "5" };

/** Per-project payment plan (owner, 14 Nov 2026): set on the project, used by New booking. */
describe.skipIf(!hasTestDb)("Project payment plan (PostgreSQL integration)", () => {
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

  it("Admins set it; agents can't; New booking uses it, and parts left unset fall back to the standard plan", async () => {
    const before = await bookingFormOptions(db, f.actors.agent1, f.projectId);
    expect(before.plan).toMatchObject({ everyMonths: 1, possessionPct: 0, balloonCount: 0 });
    expect(await codeOf(updateProjectPaymentPlan(db, f.actors.agent1, f.projectId, plan))).toBe("FORBIDDEN");
    await updateProjectPaymentPlan(db, f.actors.superAdmin, f.projectId, plan);
    const [p] = await db.select({ paymentPlan: projects.paymentPlan }).from(projects).where(eq(projects.id, f.projectId));
    expect(p.paymentPlan).toEqual({ downPaymentPct: 35, installmentCount: 36, everyMonths: 1, possessionPct: 10, balloonCount: 2, balloonPct: 5 });
    expect((await bookingFormOptions(db, f.actors.agent1, f.projectId)).plan).toEqual(p.paymentPlan);
  });

  it("refuses a plan whose parts leave nothing for the installments", async () => {
    expect(await codeOf(updateProjectPaymentPlan(db, f.actors.superAdmin, f.projectId, { ...plan, downPaymentPct: "60", possessionPct: "30", balloonCount: "2" }))).toBe("VALIDATION_FAILED");
  });
});
