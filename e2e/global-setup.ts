import { rm } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { advanceBooking, createBooking } from "@/modules/bookings/commands";
import { recordPayment } from "@/modules/finance/commands";
import { listPaymentMethods } from "@/modules/finance/queries";
import { createUnit } from "@/modules/inventory/commands";
import { createLead } from "@/modules/leads/commands";
import { updateReminderMinutes } from "@/modules/notifications/service";
import { hashPassword } from "@/server/auth/password";
import { loadActor } from "@/server/auth/session-store";
import { users } from "@/server/db/schema";
import { connectTestDb, leadInput, resetDb, seedFixture } from "../tests/support/db";
import { E2E_STORAGE_DIR, testDatabaseUrl } from "./support/guard";
import { E2E_PASSWORD, type Seed } from "./support/seed";

/**
 * Prepares the TEST database: migrations, then a fresh synthetic fixture (no client data):
 * the shared Vitest users and projects, plus an admin, an accountant, a 30-minute reminder window
 * and one booking with a payment for the finance reports. Tests add their own records on top.
 */
export default async function globalSetup() {
  const url = testDatabaseUrl();
  const pool = new pg.Pool({ connectionString: url });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }
  await rm(E2E_STORAGE_DIR, { recursive: true, force: true });

  const { db, close } = connectTestDb();
  try {
    await resetDb(db);
    const f = await seedFixture(db);
    const passwordHash = await hashPassword(E2E_PASSWORD);
    const make = async (name: string, email: string, role: "admin" | "accountant") => {
      const [u] = await db.insert(users).values({ name, email, role, passwordHash }).returning();
      return loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    };
    const admin = await make("E2E Admin", "admin@test.local", "admin");
    const accountant = await make("E2E Accountant", "acc@test.local", "accountant");
    await updateReminderMinutes(db, admin, { minutes: "30" });

    // Finance: one booking (500 sq ft × 25,000 = 12,500,000) with a 500,000 payment today.
    const lead = await createLead(db, f.actors.manager, leadInput(f, { name: "E2E Booking Lead", ownerId: f.actors.agent1.id }));
    if (lead.outcome !== "created") throw new Error("[e2e] seed lead");
    const { unitId } = await createUnit(db, f.actors.superAdmin, { projectId: f.projectId, unitNo: "E2E-1", areaSqft: "500", basePrice: "1" });
    const { bookingId } = await createBooking(db, f.actors.agent1, { projectId: f.projectId, leadId: lead.leadId, unitId, ratePerSqft: "25000", tokenAmount: "500000" });
    await advanceBooking(db, f.actors.superAdmin, bookingId, { toStage: "token_pending" });
    const cashId = (await listPaymentMethods(db, { activeOnly: true })).find((m) => m.name === "Cash")!.id;
    const today = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
    await recordPayment(db, accountant, { bookingId, type: "token", amount: "500000", receivedOn: today, methodId: cashId });

    const seed: Seed = {
      projectId: f.projectId,
      otherProjectId: f.otherProjectId,
      lostReasonId: f.lostReasonId,
      sourceId: f.sourceId,
      today,
      users: {
        superAdmin: { id: f.actors.superAdmin.id, email: "sa@test.local", name: f.actors.superAdmin.name },
        admin: { id: admin.id, email: "admin@test.local", name: admin.name },
        manager: { id: f.actors.manager.id, email: "manager@test.local", name: f.actors.manager.name },
        agent1: { id: f.actors.agent1.id, email: "agent1@test.local", name: f.actors.agent1.name },
        agent2: { id: f.actors.agent2.id, email: "agent2@test.local", name: f.actors.agent2.name },
        hr: { id: f.actors.hr.id, email: "hr@test.local", name: f.actors.hr.name },
        accountant: { id: accountant.id, email: "acc@test.local", name: accountant.name },
      },
    };
    process.env.E2E_SEED = JSON.stringify(seed);
  } finally {
    await close();
  }
}
