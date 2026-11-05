import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addCity, listCities, updateCity } from "@/modules/cities/service";
import { cityOptions, OTHER_CITY } from "@/modules/cities/constants";
import { cityNameSchema } from "@/modules/cities/validation";
import { convertLeadToClient, createClient, updateClient } from "@/modules/clients/commands";
import { getClientDetail, listClients } from "@/modules/clients/queries";
import { createLead, updateLead } from "@/modules/leads/commands";
import { getLeadDetail, leadLookups, listLeads } from "@/modules/leads/queries";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, cities, clients, leads, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

/** The error a call fails with, so a test can check its code and field. */
async function failure(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

describe("FR-042: what counts as a city name", () => {
  it.each(["Murree", "Dera Ismail Khan", "D.I. Khan", "Rahim Yar Khan", "Mirpur-Khas", "Bahawal'pur", "مری", "Zürich"])("accepts %s", (name) => {
    expect(cityNameSchema.safeParse(name).success).toBe(true);
  });

  it.each(["12345", "03001234567", "+92 300 1234567", "0300-1234567", "(051) 1234567", "Lahore 54000", "City7", "٠٣٠٠١٢٣٤٥٦٧", "۱۲۳"])("rejects %s", (name) => {
    expect(cityNameSchema.safeParse(name).success).toBe(false);
  });

  it.each(["", "   ", "A", "-", "Other", " other ", "x".repeat(61)])("rejects %j", (name) => {
    expect(cityNameSchema.safeParse(name).success).toBe(false);
  });

  it("tidies spacing", () => {
    expect(cityNameSchema.parse("  Dera   Ismail  Khan ")).toBe("Dera Ismail Khan");
  });

  it("offers Other last, and keeps a record's inactive city", () => {
    const list = [{ id: "a", name: "Lahore" }];
    expect(cityOptions(list).map((o) => o.label)).toEqual(["Lahore", "Other"]);
    expect(cityOptions(list, { id: "a", name: "Lahore" }).map((o) => o.label)).toEqual(["Lahore", "Other"]);
    expect(cityOptions(list, { id: "b", name: "Quetta" }).map((o) => o.label)).toEqual(["Lahore", "Quetta (inactive)", "Other"]);
  });
});

describe.skipIf(!hasTestDb)("FR-042: city administration and the Other city (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let admin: Actor;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const [u] = await db.insert(users).values({ name: "City Admin", email: "cityadmin@test.local", role: "admin", passwordHash: "x" }).returning();
    admin = await loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
  });

  let phone = 3_400_000;
  const nextPhone = () => `0300${(phone += 1)}`;
  const newLead = async (overrides: Record<string, unknown> = {}) => {
    const r = await createLead(db, f.actors.agent1, leadInput(f, overrides));
    return r.leadId as string;
  };
  const leadRow = async (id: string) => (await db.select().from(leads).where(eq(leads.id, id)))[0];
  const clientRow = async (id: string) => (await db.select().from(clients).where(eq(clients.id, id)))[0];
  const newClient = async (overrides: Record<string, unknown> = {}) =>
    (await createClient(db, f.actors.superAdmin, { name: "City Buyer", phoneCountryCode: "+92", phoneNumber: nextPhone(), ...overrides })).clientId;
  const namedCity = async (name: string) => (await addCity(db, admin, { name })).cityId;
  const deactivate = (id: string) => updateCity(db, admin, id, { isActive: false });
  const audits = (action: string) => db.select().from(auditLogs).where(and(eq(auditLogs.action, action), eq(auditLogs.entity, "city")));

  describe("permissions", () => {
    it("super admins and admins manage the list", async () => {
      expect((await listCities(db, admin)).map((c) => c.name)).toEqual(["Islamabad"]);
      expect((await listCities(db, f.actors.superAdmin)).map((c) => c.name)).toEqual(["Islamabad"]);
      await addCity(db, f.actors.superAdmin, { name: "Murree" });
    });

    it("no other role can read or change it", async () => {
      const [accountantUser] = await db.insert(users).values({ name: "Acc", email: "acc@test.local", role: "accountant", passwordHash: "x" }).returning();
      const accountant = await loadActor(db, { id: accountantUser.id, name: accountantUser.name, email: accountantUser.email, role: accountantUser.role });
      for (const who of [f.actors.manager, f.actors.agent1, f.actors.hr, accountant]) {
        expect((await failure(listCities(db, who))).code).toBe("FORBIDDEN");
        expect((await failure(addCity(db, who, { name: "Murree" }))).code).toBe("FORBIDDEN");
        expect((await failure(updateCity(db, who, f.cityId, { name: "Renamed" }))).code).toBe("FORBIDDEN");
        expect((await failure(updateCity(db, who, f.cityId, { isActive: false }))).code).toBe("FORBIDDEN");
      }
      expect((await db.select().from(cities)).map((c) => [c.name, c.isActive])).toEqual([["Islamabad", true]]);
    });
  });

  describe("managing the list", () => {
    it("a new city goes last, appears on the forms and is audited", async () => {
      const id = await namedCity("  Murree ");
      expect((await db.select().from(cities).where(eq(cities.id, id)))[0]).toMatchObject({ name: "Murree", isActive: true, sortOrder: 1 });
      expect((await leadLookups(db)).cities.map((c) => c.name)).toEqual(["Islamabad", "Murree"]);
      const [log] = await audits("city.add");
      expect(log).toMatchObject({ actorId: admin.id, entityId: id, after: { name: "Murree" } });
    });

    it("rejects numbers, phone numbers and Other as list names", async () => {
      for (const name of ["12345", "03001234567", "+92 300 1234567", "Other", ""]) {
        const error = await failure(addCity(db, admin, { name }));
        expect(error.code).toBe("VALIDATION_FAILED");
        expect(error.fields?.name).toBeTruthy();
        expect((await failure(updateCity(db, admin, f.cityId, { name }))).fields?.name).toBeTruthy();
      }
      expect(await db.select().from(cities)).toHaveLength(1);
    });

    it("rejects duplicates in any letter case, including inactive cities", async () => {
      for (const name of ["Islamabad", "ISLAMABAD", " islamabad "]) {
        expect((await failure(addCity(db, admin, { name }))).fields?.name).toBe("This city is already on the list");
      }
      const id = await namedCity("Murree");
      expect((await failure(updateCity(db, admin, id, { name: "islamabad" }))).fields?.name).toBe("This city is already on the list");
      await deactivate(id);
      expect((await failure(addCity(db, admin, { name: "MURREE" }))).fields?.name).toBe("This city is already on the list");
    });

    it("two simultaneous adds of one city create one row", async () => {
      const results = await Promise.allSettled([addCity(db, admin, { name: "Murree" }), addCity(db, f.actors.superAdmin, { name: "MURREE" })]);
      expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
      expect(await db.select().from(cities)).toHaveLength(2);
    });

    it("a rename shows on every record, keeps their links and is audited", async () => {
      const leadId = await newLead();
      const clientId = await newClient({ cityId: f.cityId });
      await updateCity(db, admin, f.cityId, { name: "Islamabad Capital" });
      expect((await leadRow(leadId)).cityId).toBe(f.cityId);
      expect((await getLeadDetail(db, f.actors.superAdmin, leadId)).lead.cityName).toBe("Islamabad Capital");
      expect((await getClientDetail(db, f.actors.superAdmin, clientId)).client.cityName).toBe("Islamabad Capital");
      const [log] = await audits("city.rename");
      expect(log).toMatchObject({ before: { name: "Islamabad" }, after: { name: "Islamabad Capital" } });
    });

    it("changing only the letter case of a name is allowed", async () => {
      await updateCity(db, admin, f.cityId, { name: "ISLAMABAD" });
      expect((await listCities(db, admin))[0].name).toBe("ISLAMABAD");
    });

    it("saving no change records nothing", async () => {
      expect(await updateCity(db, admin, f.cityId, { name: "Islamabad", isActive: true })).toEqual({ changed: false });
      expect(await db.select().from(auditLogs).where(eq(auditLogs.entity, "city"))).toHaveLength(0);
    });

    it("deactivate and reactivate are audited and change what is offered", async () => {
      await deactivate(f.cityId);
      expect((await leadLookups(db)).cities).toEqual([]);
      expect(await audits("city.deactivate")).toHaveLength(1);
      await updateCity(db, admin, f.cityId, { isActive: true });
      expect((await leadLookups(db)).cities.map((c) => c.name)).toEqual(["Islamabad"]);
      expect(await audits("city.activate")).toHaveLength(1);
    });

    it("an unknown or malformed city id is not found", async () => {
      expect((await failure(updateCity(db, admin, UNKNOWN_ID, { name: "Murree" }))).code).toBe("NOT_FOUND");
      expect((await failure(updateCity(db, admin, "not-an-id", { name: "Murree" }))).code).toBe("NOT_FOUND");
    });

    it("the list counts the records using each city, inactive ones included", async () => {
      await newLead();
      await newLead();
      await newClient({ cityId: f.cityId });
      await deactivate(f.cityId);
      expect((await listCities(db, admin))[0]).toMatchObject({ name: "Islamabad", isActive: false, leads: 2, clients: 1 });
    });

    it("the database refuses to delete a city records use", async () => {
      await newLead();
      await expect(db.delete(cities).where(eq(cities.id, f.cityId))).rejects.toThrow();
      expect(await db.select().from(cities)).toHaveLength(1);
    });
  });

  describe("leads", () => {
    it("a list city still works, and no city still works", async () => {
      expect(await leadRow(await newLead())).toMatchObject({ cityId: f.cityId, cityOther: null });
      expect(await leadRow(await newLead({ cityId: "" }))).toMatchObject({ cityId: null, cityOther: null });
    });

    it("Other stores the typed name and shows it as the city", async () => {
      const id = await newLead({ cityId: OTHER_CITY, cityOther: "  Murree " });
      expect(await leadRow(id)).toMatchObject({ cityId: null, cityOther: "Murree" });
      const { lead } = await getLeadDetail(db, f.actors.agent1, id);
      expect(lead).toMatchObject({ cityName: "Murree", cityOther: "Murree", cityId: null });
    });

    it("Other rejects numbers, phone numbers and a blank name, on create and edit", async () => {
      const id = await newLead();
      for (const cityOther of ["12345", "03001234567", "+92 300 1234567", "", undefined]) {
        const created = await failure(createLead(db, f.actors.agent1, leadInput(f, { cityId: OTHER_CITY, cityOther })));
        expect(created.code).toBe("VALIDATION_FAILED");
        expect(created.fields?.cityOther).toBeTruthy();
        expect((await failure(updateLead(db, f.actors.agent1, id, { cityId: OTHER_CITY, cityOther }))).fields?.cityOther).toBeTruthy();
      }
      expect(await leadRow(id)).toMatchObject({ cityId: f.cityId, cityOther: null });
    });

    it("a typed name matching an active list city uses that city", async () => {
      expect(await leadRow(await newLead({ cityId: OTHER_CITY, cityOther: "ISLAMABAD" }))).toMatchObject({ cityId: f.cityId, cityOther: null });
    });

    it("a typed name matching an inactive city stays typed", async () => {
      await deactivate(f.cityId);
      expect(await leadRow(await newLead({ cityId: OTHER_CITY, cityOther: "Islamabad" }))).toMatchObject({ cityId: null, cityOther: "Islamabad" });
    });

    it("a forged or unknown city id is a field error, not a crash", async () => {
      const unknown = await failure(createLead(db, f.actors.agent1, leadInput(f, { cityId: UNKNOWN_ID })));
      expect(unknown.code).toBe("VALIDATION_FAILED");
      expect(unknown.fields?.cityId).toBeTruthy();
      const id = await newLead();
      expect((await failure(updateLead(db, f.actors.agent1, id, { cityId: UNKNOWN_ID }))).fields?.cityId).toBeTruthy();
      expect((await failure(createLead(db, f.actors.agent1, leadInput(f, { cityId: "Lahore" })))).code).toBe("VALIDATION_FAILED");
    });

    it("an inactive city can't be newly chosen, but a record keeps the one it has", async () => {
      const id = await newLead();
      const spare = await newLead({ cityId: "" });
      await deactivate(f.cityId);
      expect((await leadRow(id)).cityId).toBe(f.cityId);
      expect((await failure(createLead(db, f.actors.agent1, leadInput(f)))).fields?.cityId).toBe("This city is no longer available");
      expect((await failure(updateLead(db, f.actors.agent1, spare, { cityId: f.cityId }))).fields?.cityId).toBe("This city is no longer available");

      // Saving the form unchanged, or editing another field, keeps it.
      await updateLead(db, f.actors.agent1, id, { cityId: f.cityId, cityOther: "", name: "Kept City" });
      expect(await leadRow(id)).toMatchObject({ name: "Kept City", cityId: f.cityId, cityOther: null });
      expect((await getLeadDetail(db, f.actors.agent1, id)).lead.cityName).toBe("Islamabad");
    });

    it("editing moves cleanly between a list city, Other and none", async () => {
      const id = await newLead();
      await updateLead(db, f.actors.agent1, id, { cityId: OTHER_CITY, cityOther: "Murree" });
      expect(await leadRow(id)).toMatchObject({ cityId: null, cityOther: "Murree" });
      await updateLead(db, f.actors.agent1, id, { cityId: f.cityId, cityOther: "Murree" });
      expect(await leadRow(id)).toMatchObject({ cityId: f.cityId, cityOther: null });
      await updateLead(db, f.actors.agent1, id, { cityId: OTHER_CITY, cityOther: "Murree" });
      await updateLead(db, f.actors.agent1, id, { cityId: "", cityOther: "Murree" });
      expect(await leadRow(id)).toMatchObject({ cityId: null, cityOther: null });
    });

    it("a partial update without a city leaves it alone", async () => {
      const other = await newLead({ cityId: OTHER_CITY, cityOther: "Murree" });
      const listed = await newLead();
      await updateLead(db, f.actors.agent1, other, { name: "Renamed" });
      await updateLead(db, f.actors.agent1, listed, { cityOther: "" });
      expect(await leadRow(other)).toMatchObject({ cityId: null, cityOther: "Murree" });
      expect(await leadRow(listed)).toMatchObject({ cityId: f.cityId, cityOther: null });
    });

    it("the audit row shows the typed city changing", async () => {
      const id = await newLead();
      const { changed } = await updateLead(db, f.actors.agent1, id, { cityId: OTHER_CITY, cityOther: "Murree" });
      expect([...changed].sort()).toEqual(["cityId", "cityOther"]);
      expect((await updateLead(db, f.actors.agent1, id, { cityId: OTHER_CITY, cityOther: "Murree" })).changed).toEqual([]);
    });

    it("filters find list cities, inactive cities and Other", async () => {
      const listed = await newLead();
      const typed = await newLead({ cityId: OTHER_CITY, cityOther: "Murree" });
      const none = await newLead({ cityId: "" });
      const ids = async (city: string) => (await listLeads(db, f.actors.superAdmin, f.projectId, { city })).rows.map((r) => r.id).sort();
      expect(await ids(f.cityId)).toEqual([listed]);
      expect(await ids(OTHER_CITY)).toEqual([typed]);
      expect(await ids(`${f.cityId},${OTHER_CITY}`)).toEqual([listed, typed].sort());
      await deactivate(f.cityId);
      expect(await ids(f.cityId)).toEqual([listed]);
      expect((await ids("not-a-city")).sort()).toEqual([listed, typed, none].sort());

      const { filterCities } = await leadLookups(db);
      expect(filterCities).toEqual([
        { id: f.cityId, name: "Islamabad (inactive)" },
        { id: OTHER_CITY, name: "Other" },
      ]);
    });

    it("the list shows and sorts by typed cities with list cities", async () => {
      await newLead({ name: "Zed", cityId: OTHER_CITY, cityOther: "Abbottabad Town" });
      await newLead({ name: "Yan" });
      const { rows } = await listLeads(db, f.actors.superAdmin, f.projectId, { sort: "city", dir: "asc" });
      expect(rows.map((r) => r.cityName)).toEqual(["Abbottabad Town", "Islamabad"]);
    });
  });

  describe("clients", () => {
    it("Other works on create and edit, with the same rules as leads", async () => {
      const id = await newClient({ cityId: OTHER_CITY, cityOther: "Murree" });
      expect(await clientRow(id)).toMatchObject({ cityId: null, cityOther: "Murree" });
      expect((await getClientDetail(db, f.actors.superAdmin, id)).client).toMatchObject({ cityName: "Murree", cityOther: "Murree" });
      expect((await listClients(db, f.actors.superAdmin, {})).rows[0].cityName).toBe("Murree");

      await updateClient(db, f.actors.superAdmin, id, { cityId: f.cityId });
      expect(await clientRow(id)).toMatchObject({ cityId: f.cityId, cityOther: null });

      for (const cityOther of ["03001234567", "12345", ""]) {
        expect((await failure(updateClient(db, f.actors.superAdmin, id, { cityId: OTHER_CITY, cityOther }))).fields?.cityOther).toBeTruthy();
      }
      expect((await failure(createClient(db, f.actors.superAdmin, { name: "Bad", phoneCountryCode: "+92", phoneNumber: nextPhone(), cityId: UNKNOWN_ID }))).fields?.cityId).toBeTruthy();
    });

    it("a client keeps its inactive city, and can't newly take one", async () => {
      const keeps = await newClient({ cityId: f.cityId });
      const spare = await newClient();
      await deactivate(f.cityId);
      await updateClient(db, f.actors.superAdmin, keeps, { cityId: f.cityId, name: "Still Here" });
      expect(await clientRow(keeps)).toMatchObject({ name: "Still Here", cityId: f.cityId });
      expect((await failure(updateClient(db, f.actors.superAdmin, spare, { cityId: f.cityId }))).fields?.cityId).toBe("This city is no longer available");
    });

    it("converting a lead carries its city, typed or inactive", async () => {
      const typed = await newLead({ cityId: OTHER_CITY, cityOther: "Murree" });
      const { clientId } = await convertLeadToClient(db, f.actors.manager, { leadId: typed });
      expect(await clientRow(clientId as string)).toMatchObject({ cityId: null, cityOther: "Murree" });

      const listed = await newLead();
      await deactivate(f.cityId);
      const converted = await convertLeadToClient(db, f.actors.manager, { leadId: listed });
      expect(await clientRow(converted.clientId as string)).toMatchObject({ cityId: f.cityId, cityOther: null });
    });
  });
});
