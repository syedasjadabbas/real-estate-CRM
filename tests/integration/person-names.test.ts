import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { nameFromParts, splitName } from "@/lib/person-name";
import { createAccount, updateAccount } from "@/modules/accounts/service";
import { createEmployeeRecord, saveEmployeeRecord } from "@/modules/employees/service";
import { createLead, updateLead } from "@/modules/leads/commands";
import { LEAD_IMPORT_COLUMNS, submitImport } from "@/modules/leads/imports";
import { clients, employeeProfiles, leadImportRows, leads, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

describe("splitting a full name", () => {
  it("keeps a title with the first name", () => {
    expect(splitName("Mr  Zubair Anjum Ihr")).toEqual({ firstName: "Mr Zubair", lastName: "Anjum Ihr" });
    expect(splitName("Col. Arshad")).toEqual({ firstName: "Col. Arshad", lastName: "" });
    expect(splitName("umer")).toEqual({ firstName: "umer", lastName: "" });
    expect(nameFromParts({ name: "Old Api" })).toEqual({ input: { name: "Old Api" }, parts: null });
    expect(nameFromParts({ firstName: " ", lastName: "Khan" }).input).toEqual({ name: "" });
  });
});

describe.skipIf(!hasTestDb)("First and last names (client, 23 Nov 2026; PostgreSQL)", () => {
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

  it("a lead keeps both names, passes them to its client, and an edit can move the split or rename", async () => {
    const r = await createLead(db, f.actors.superAdmin, { ...leadInput(f, { ownerId: f.actors.agent1.id }), name: undefined, firstName: "Ali Raza", lastName: "Khan" });
    if (r.outcome !== "created") throw new Error("setup");
    const read = async () => (await db.select().from(leads).where(eq(leads.id, r.leadId)))[0];
    const lead = await read();
    expect(lead).toMatchObject({ name: "Ali Raza Khan", firstName: "Ali Raza", lastName: "Khan" });
    const [client] = await db.select().from(clients).where(eq(clients.id, lead.clientId!));
    expect(client).toMatchObject({ name: "Ali Raza Khan", firstName: "Ali Raza", lastName: "Khan" });

    expect((await updateLead(db, f.actors.superAdmin, r.leadId, { firstName: "Ali Raza", lastName: "Khan" })).changed).toEqual([]);
    await updateLead(db, f.actors.superAdmin, r.leadId, { firstName: "Ali", lastName: "Raza Khan" });
    expect(await read()).toMatchObject({ name: "Ali Raza Khan", firstName: "Ali", lastName: "Raza Khan" });
    expect((await updateLead(db, f.actors.superAdmin, r.leadId, { firstName: "Bilal", lastName: "" })).changed).toEqual(["name"]);
    expect(await read()).toMatchObject({ name: "Bilal", firstName: "Bilal", lastName: null });
    // A full name alone (older callers) is split by the database.
    await updateLead(db, f.actors.superAdmin, r.leadId, { name: "Dr Sara Malik" });
    expect(await read()).toMatchObject({ firstName: "Dr Sara", lastName: "Malik" });
  });

  it("the first name is required; the last name is not", async () => {
    const error = await createLead(db, f.actors.superAdmin, { ...leadInput(f), name: undefined, firstName: "", lastName: "Khan" }).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error.fields).toHaveProperty("name");
  });

  it("staff accounts and HR records keep both names", async () => {
    const { id } = await createAccount(db, f.actors.superAdmin, { firstName: "Hina", lastName: "Shah", email: "hina@test.local", role: "agent", password: "a-long-test-passphrase-1" });
    const user = async () => (await db.select().from(users).where(eq(users.id, id)))[0];
    expect(await user()).toMatchObject({ name: "Hina Shah", firstName: "Hina", lastName: "Shah" });
    await updateAccount(db, f.actors.superAdmin, id, { firstName: "Hina Bibi", lastName: "Shah" });
    expect(await user()).toMatchObject({ name: "Hina Bibi Shah", firstName: "Hina Bibi", lastName: "Shah" });
    const record = await createEmployeeRecord(db, f.actors.hr, { firstName: "Office", lastName: "Driver" });
    await saveEmployeeRecord(db, f.actors.hr, record.id, { firstName: "Office Van", lastName: "Driver" });
    const [row] = await db.select().from(employeeProfiles).where(eq(employeeProfiles.id, record.id));
    expect(row).toMatchObject({ fullName: "Office Van Driver", firstName: "Office Van", lastName: "Driver" });
  });

  it("the import file has first_name and last_name; a file with one name column still works", async () => {
    expect(LEAD_IMPORT_COLUMNS.slice(0, 2)).toEqual(["first_name", "last_name"]);
    await submitImport(db, f.actors.superAdmin, { projectId: f.projectId, fileName: "a.csv", csv: "first_name,last_name,phone,source\nAli,Khan,03001112201,Facebook\n,Khan,03001112202,Facebook" });
    await submitImport(db, f.actors.superAdmin, { projectId: f.projectId, fileName: "b.csv", csv: "name,phone,source\nOld File,03001112203,Facebook" });
    const rows = await db.select().from(leadImportRows);
    expect(rows.map((r) => r.status).sort()).toEqual(["invalid", "valid", "valid"]);
    const valid = rows.filter((r) => r.status === "valid").map((r) => (r.data as { name: string }).name).sort();
    expect(valid).toEqual(["Ali Khan", "Old File"]);
  });
});
