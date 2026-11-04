import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { convertLeadToClient, createClient } from "@/modules/clients/commands";
import { getClientDetail } from "@/modules/clients/queries";
import { listClientDocuments, openDocument, uploadClientDocument, uploadDocument } from "@/modules/documents/service";
import { MAX_DOCUMENT_BYTES } from "@/modules/documents/validation";
import { createLead } from "@/modules/leads/commands";
import { openRecording, uploadRecording } from "@/modules/recordings/service";
import { loadActor } from "@/server/auth/session-store";
import { auditLogs, clientActivities, clients, files, leads, users } from "@/server/db/schema";
import { readObject } from "@/server/storage/local";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

const errorCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
};
const enc = (s: string) => new TextEncoder().encode(s);
const pad = (head: number[] | Uint8Array, size = 256) => {
  const b = new Uint8Array(size);
  b.set(head);
  return b;
};
const pdf = () => pad(enc("%PDF-1.7\n%âãÏÓ\n"));
const png = () => pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe.skipIf(!hasTestDb)("F-20: client contracts and documents (FR-052, PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let admin: Actor;
  let accountant: Actor;
  let storageDir: string;
  let previousStorage: string | undefined;
  let phone = 0;

  const stored = async () => {
    const out: string[] = [];
    const walk = async (dir: string) => {
      for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (e.isDirectory()) await walk(path.join(dir, e.name));
        else out.push(path.join(dir, e.name));
      }
    };
    await walk(storageDir);
    return out;
  };

  beforeAll(async () => {
    ({ db, close } = connectTestDb());
    storageDir = await mkdtemp(path.join(tmpdir(), "mz-client-documents-"));
    previousStorage = process.env.FILE_STORAGE_DIR;
    process.env.FILE_STORAGE_DIR = storageDir;
  });
  afterAll(async () => {
    if (previousStorage === undefined) delete process.env.FILE_STORAGE_DIR;
    else process.env.FILE_STORAGE_DIR = previousStorage;
    await rm(storageDir, { recursive: true, force: true });
    await close();
  });
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const make = async (name: string, email: string, role: "admin" | "accountant") => {
      const [u] = await db.insert(users).values({ name, email, role, passwordHash: "x" }).returning();
      return loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    };
    admin = await make("Zed Admin", "admin@test.local", "admin");
    accountant = await make("Acc", "acc@test.local", "accountant");
  });

  /** A client owned by `owner`, added by hand (so it has no lead). */
  const manualClient = async (owner: Actor = f.actors.agent1) => {
    phone += 1;
    return (await createClient(db, f.actors.superAdmin, { name: "Contract Buyer", phoneCountryCode: "+92", phoneNumber: `0301${String(phone).padStart(7, "0")}`, ownerId: owner.id })).clientId;
  };
  const leadClient = async (owner: Actor = f.actors.agent1) => {
    const r = await createLead(db, f.actors.superAdmin, leadInput(f, { ownerId: owner.id }));
    if (r.outcome !== "created") throw new Error("lead");
    const { clientId } = await convertLeadToClient(db, f.actors.superAdmin, { leadId: r.leadId });
    return { leadId: r.leadId, clientId };
  };
  const upload = (actor: Actor, clientId: string, name = "contract.pdf", bytes = pdf()) => uploadClientDocument(db, actor, clientId, { bytes, name });

  describe("uploading", () => {
    it("keeps a contract on a client with no lead, with timeline, audit and the exact bytes", async () => {
      const clientId = await manualClient();
      const bytes = pdf();
      const { id } = await upload(f.actors.agent1, clientId, "Sale Contract.pdf", bytes);

      const [doc] = await listClientDocuments(db, f.actors.agent1, clientId);
      expect(doc).toMatchObject({ id, name: "Sale Contract.pdf", mime: "application/pdf", sizeBytes: 256, uploadedBy: f.actors.agent1.name, origin: null });
      const [row] = await db.select().from(files).where(eq(files.id, id));
      expect(row).toMatchObject({ clientId, leadId: null, kind: "document", uploadedById: f.actors.agent1.id });
      const chunks: Buffer[] = [];
      for await (const c of readObject(row.storageKey) as unknown as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
      expect(Buffer.compare(Buffer.concat(chunks), Buffer.from(bytes))).toBe(0);

      expect(await db.select().from(clientActivities).where(and(eq(clientActivities.clientId, clientId), eq(clientActivities.type, "file_uploaded")))).toEqual([
        expect.objectContaining({ actorId: f.actors.agent1.id, body: "Sale Contract.pdf", data: { fileId: id } }),
      ]);
      const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "client.document_upload"), eq(auditLogs.entityId, clientId)));
      expect(audit).toMatchObject({ actorId: f.actors.agent1.id, entity: "client", after: expect.objectContaining({ fileId: id, name: "Sale Contract.pdf", sha256: row.sha256 }) });
      expect(JSON.stringify(audit.after)).not.toContain("storage");
    });

    it("works after booking, while the booked lead itself stays read-only", async () => {
      const { leadId, clientId } = await leadClient();
      await db.update(leads).set({ stage: "booked" }).where(eq(leads.id, leadId));
      expect(await errorCode(uploadDocument(db, f.actors.agent1, leadId, { bytes: pdf(), name: "a.pdf" }))).toBe("BUSINESS_RULE");
      expect(await errorCode(upload(f.actors.agent1, clientId))).toBe("ok");
    });

    it("refuses empty, oversized, wrong-type and disguised files, leaving nothing behind", async () => {
      const clientId = await manualClient();
      const before = (await stored()).length;
      const audits = (await db.select().from(auditLogs)).length;
      expect(await errorCode(upload(f.actors.agent1, clientId, "a.pdf", new Uint8Array()))).toBe("VALIDATION_FAILED");
      expect(await errorCode(upload(f.actors.agent1, clientId, "a.pdf", pad(enc("%PDF-1.7\n"), MAX_DOCUMENT_BYTES + 1)))).toBe("VALIDATION_FAILED");
      expect(await errorCode(upload(f.actors.agent1, clientId, "virus.exe", pad(enc("MZ"))))).toBe("VALIDATION_FAILED");
      expect(await errorCode(upload(f.actors.agent1, clientId, "fake.pdf", png()))).toBe("VALIDATION_FAILED");
      expect(await db.select().from(files).where(eq(files.clientId, clientId))).toEqual([]);
      expect((await stored()).length).toBe(before);
      expect((await db.select().from(auditLogs)).length).toBe(audits);
    });

    it("simultaneous uploads are all kept", async () => {
      const clientId = await manualClient();
      await Promise.all(["a.pdf", "b.pdf", "c.pdf", "d.pdf"].map((n) => upload(f.actors.agent1, clientId, n)));
      expect((await listClientDocuments(db, f.actors.agent1, clientId)).map((d) => d.name).sort()).toEqual(["a.pdf", "b.pdf", "c.pdf", "d.pdf"]);
    });
  });

  describe("permissions follow the client rules", () => {
    it("edit: owner agent, their manager and admins upload; accountants don't; others can't see the client", async () => {
      const clientId = await manualClient();
      for (const who of [f.actors.agent1, f.actors.manager, admin, f.actors.superAdmin]) expect(await errorCode(upload(who, clientId))).toBe("ok");
      expect(await errorCode(upload(accountant, clientId))).toBe("FORBIDDEN");
      expect(await errorCode(upload(f.actors.hr, clientId))).toBe("FORBIDDEN");
      expect(await errorCode(upload(f.actors.agent2, clientId))).toBe("NOT_FOUND");
      expect(await errorCode(upload(f.actors.outsideAgent, clientId))).toBe("NOT_FOUND");
      expect(await errorCode(upload(f.actors.agent1, "not-a-client"))).toBe("NOT_FOUND");
    });

    it("view: those who may see the client read and open it; others get 404, HR 403", async () => {
      const clientId = await manualClient();
      const { id } = await upload(f.actors.agent1, clientId);
      for (const who of [f.actors.agent1, f.actors.manager, admin, f.actors.superAdmin, accountant]) {
        expect((await listClientDocuments(db, who, clientId)).map((d) => d.id)).toEqual([id]);
        expect((await openDocument(db, who, id)).id).toBe(id);
      }
      expect(await errorCode(listClientDocuments(db, f.actors.agent2, clientId))).toBe("NOT_FOUND");
      expect(await errorCode(openDocument(db, f.actors.agent2, id))).toBe("NOT_FOUND");
      expect(await errorCode(openDocument(db, f.actors.outsideAgent, id))).toBe("NOT_FOUND");
      expect(await errorCode(listClientDocuments(db, f.actors.hr, clientId))).toBe("FORBIDDEN");
      expect(await errorCode(openDocument(db, f.actors.hr, id))).toBe("FORBIDDEN");
    });

    it("access moves with the client's owner", async () => {
      const clientId = await manualClient(f.actors.agent1);
      const { id } = await upload(f.actors.agent1, clientId);
      await db.update(clients).set({ ownerId: f.actors.outsideAgent.id }).where(eq(clients.id, clientId));
      expect(await errorCode(openDocument(db, f.actors.agent1, id))).toBe("NOT_FOUND");
      expect((await openDocument(db, f.actors.outsideAgent, id)).id).toBe(id);
    });
  });

  describe("documents from the client's leads", () => {
    it("are listed with their lead, only for those who may open that lead", async () => {
      const { leadId, clientId } = await leadClient(f.actors.agent1);
      const fromLead = await uploadDocument(db, f.actors.agent1, leadId, { bytes: png(), name: "cnic.png" });
      const own = await upload(f.actors.agent1, clientId);
      const [{ code }] = await db.select({ code: leads.code }).from(leads).where(eq(leads.id, leadId));

      const list = await listClientDocuments(db, f.actors.agent1, clientId);
      expect(list.map((d) => [d.id, d.origin])).toEqual([[own.id, null], [fromLead.id, `Lead ${code}`]]);
      // Accountants have no leads access: the client's own documents only.
      expect((await listClientDocuments(db, accountant, clientId)).map((d) => d.id)).toEqual([own.id]);
      expect(await errorCode(openDocument(db, accountant, fromLead.id))).toBe("FORBIDDEN");

      // The lead moves to another team: the client's owner no longer sees its documents.
      await db.update(leads).set({ ownerId: f.actors.outsideAgent.id }).where(eq(leads.id, leadId));
      expect((await listClientDocuments(db, f.actors.agent1, clientId)).map((d) => d.id)).toEqual([own.id]);
      expect((await listClientDocuments(db, admin, clientId)).map((d) => d.id).sort()).toEqual([own.id, fromLead.id].sort());
    });

    it("leaves out recordings and hidden files", async () => {
      const { leadId, clientId } = await leadClient();
      const mp3 = pad([0x49, 0x44, 0x33, 4, 0, 0]);
      await uploadRecording(db, f.actors.agent1, leadId, { bytes: mp3, name: "call.mp3" });
      const doc = await uploadDocument(db, f.actors.agent1, leadId, { bytes: pdf(), name: "a.pdf" });
      expect((await listClientDocuments(db, f.actors.agent1, clientId)).map((d) => d.id)).toEqual([doc.id]);
      await db.update(files).set({ deletedAt: new Date() }).where(eq(files.id, doc.id));
      expect(await listClientDocuments(db, f.actors.agent1, clientId)).toEqual([]);
    });
  });

  describe("existing behaviour", () => {
    it("lead documents and recordings open as before; a client document isn't a recording", async () => {
      const { leadId, clientId } = await leadClient();
      const doc = await uploadDocument(db, f.actors.agent1, leadId, { bytes: pdf(), name: "a.pdf" });
      expect((await openDocument(db, f.actors.manager, doc.id)).id).toBe(doc.id);
      expect(await errorCode(openDocument(db, f.actors.outsideAgent, doc.id))).toBe("NOT_FOUND");
      const own = await upload(f.actors.agent1, clientId);
      expect(await errorCode(openRecording(db, f.actors.agent1, own.id))).toBe("NOT_FOUND");
      expect(await errorCode(openDocument(db, f.actors.agent1, "not-a-file"))).toBe("NOT_FOUND");
    });

    it("the database still refuses a file with no owner", async () => {
      await expect(db.insert(files).values({ kind: "document", storageKey: "documents/x.pdf", originalName: "x.pdf", mime: "application/pdf", sizeBytes: 1, sha256: "x" })).rejects.toThrow();
    });

    it("the client detail is unchanged, and the timeline shows the upload", async () => {
      const clientId = await manualClient();
      await upload(f.actors.agent1, clientId);
      const detail = await getClientDetail(db, f.actors.agent1, clientId);
      expect(detail.permissions.edit).toBe(true);
      expect(detail.activities.map((a) => a.type)).toContain("file_uploaded");
    });
  });
});
