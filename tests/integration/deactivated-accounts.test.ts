import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listDeactivated } from "@/modules/accounts/deactivated";
import { setAccountStatus } from "@/modules/accounts/service";
import type { Database } from "@/server/db";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, resetDb, seedFixture, type Fixture } from "../support/db";

/** Deactivated accounts list (owner, 16 Nov 2026): who is off, since when, by whom; reactivating removes them. */
describe.skipIf(!hasTestDb)("Deactivated accounts (PostgreSQL integration)", () => {
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

  it("lists switched-off accounts with who switched them off, and reactivating removes them", async () => {
    expect(await listDeactivated(db, f.actors.superAdmin)).toEqual([]);
    await setAccountStatus(db, f.actors.superAdmin, f.actors.agent2.id, { status: "inactive" });
    const [row] = await listDeactivated(db, f.actors.superAdmin);
    expect(row).toMatchObject({ id: f.actors.agent2.id, deactivatedById: f.actors.superAdmin.id });
    expect(row.deactivatedAt).toBeInstanceOf(Date);
    await setAccountStatus(db, f.actors.superAdmin, f.actors.agent2.id, { status: "active" });
    expect(await listDeactivated(db, f.actors.superAdmin)).toEqual([]);
  });

  it("is for Admins and Super Admins only", async () => {
    for (const actor of [f.actors.agent1, f.actors.hr]) {
      await expect(listDeactivated(db, actor)).rejects.toBeInstanceOf(AppError);
    }
  });
});
