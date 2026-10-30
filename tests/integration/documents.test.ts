import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listDocuments, openDocument, uploadDocument } from "@/modules/documents/service";
import { documentFormatOf, sniffDocument } from "@/modules/documents/validation";
import { createLead } from "@/modules/leads/commands";
import { openRecording, uploadRecording } from "@/modules/recordings/service";
import { auditLogs, files, leadActivities, leads, users } from "@/server/db/schema";
import { loadActor } from "@/server/auth/session-store";
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
const jpg = () => pad([0xff, 0xd8, 0xff, 0xe0]);
const ooxml = (part: string) => pad(new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...enc(`....[Content_Types].xml....${part}....`)]), 512);
const docx = () => ooxml("word/document.xml");
const xlsx = () => ooxml("xl/workbook.xml");

describe("document content detection", () => {
  it("recognises the documented formats and nothing else", () => {
    expect([pdf(), png(), jpg(), docx(), xlsx()].map(sniffDocument)).toEqual(["pdf", "png", "jpg", "docx", "xlsx"]);
    // A plain ZIP, an ODT-like package, HTML, an executable and an MP3 are refused.
    for (const b of [pad([0x50, 0x4b, 0x03, 0x04]), ooxml("content.xml"), pad(enc("<html><script>")), pad(enc("MZ")), pad(enc("ID3"))]) expect(sniffDocument(b)).toBeNull();
    expect([documentFormatOf("jpeg"), documentFormatOf("JPG".toLowerCase()), documentFormatOf("exe"), documentFormatOf("doc")]).toEqual(["jpg", "jpg", null, null]);
  });
});

describe.skipIf(!hasTestDb)("Lead documents (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let admin: Actor;
  let accountant: Actor;
  let storageDir: string;
  let leadId: string;

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
    storageDir = await mkdtemp(path.join(tmpdir(), "mz-documents-"));
    process.env.FILE_STORAGE_DIR = storageDir;
  });
  afterAll(async () => {
    await close();
    delete process.env.FILE_STORAGE_DIR;
    await rm(storageDir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await resetDb(db);
    await rm(storageDir, { recursive: true, force: true });
    f = await seedFixture(db);
    const mk = async (role: "admin" | "accountant", email: string) => {
      const [u] = await db.insert(users).values({ name: role, email, role, passwordHash: "x" }).returning();
      return loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    };
    admin = await mk("admin", "admin@test.local");
    accountant = await mk("accountant", "acc@test.local");
    const r = await createLead(db, f.actors.agent1, leadInput(f));
    if (r.outcome !== "created") throw new Error("setup");
    leadId = r.leadId;
  });

  it("stores each documented type privately with metadata, timeline entry and audit", async () => {
    const cases: [Uint8Array, string, string][] = [
      [pdf(), "Booking form.pdf", "application/pdf"],
      [png(), "cnic-front.png", "image/png"],
      [jpg(), "site photo.jpeg", "image/jpeg"],
      [docx(), "Offer.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      [xlsx(), "Plan.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ];
    for (const [bytes, name, mime] of cases) {
      const r = await uploadDocument(db, f.actors.agent1, leadId, { bytes, name });
      const [row] = await db.select().from(files).where(eq(files.id, r.id));
      expect(row).toMatchObject({ kind: "document", mime, originalName: name, durationSec: null });
      expect(row.storageKey).toMatch(/^documents\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(pdf|png|jpg|docx|xlsx)$/);
    }
    expect(await stored()).toHaveLength(5);
    expect((await listDocuments(db, f.actors.agent1, leadId)).map((d) => d.name)).toHaveLength(5);
    const activities = await db.select().from(leadActivities).where(eq(leadActivities.type, "file_uploaded"));
    expect(activities.every((a) => (a.data as { kind: string }).kind === "document")).toBe(true);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "lead.document_upload"))).toHaveLength(5);
  });

  it("rejects wrong, disguised, empty and oversized files and stores nothing", async () => {
    const cases: [Uint8Array, string][] = [
      [pdf(), "a.exe"],
      [pdf(), "a.doc"],
      [png(), "a.pdf"], // PNG content named .pdf
      [docx(), "a.xlsx"], // Word package named .xlsx
      [enc("<html><script>alert(1)</script></html>"), "a.pdf"],
      [new Uint8Array(0), "a.pdf"],
      [pad(enc("%PDF-1.7"), 10 * 1024 * 1024 + 1), "big.pdf"],
    ];
    for (const [bytes, name] of cases) expect(await errorCode(uploadDocument(db, f.actors.agent1, leadId, { bytes, name }))).toBe("VALIDATION_FAILED");
    expect(await errorCode(uploadDocument(db, f.actors.agent1, leadId, { bytes: pad(enc("%PDF-1.7"), 10 * 1024 * 1024), name: "max.pdf" }))).toBe("ok");
    expect(await db.select().from(files)).toHaveLength(1);
    expect(await stored()).toHaveLength(1);
  });

  it("follows the lead rules for upload and read, and keeps documents and recordings apart", async () => {
    for (const actor of [f.actors.agent1, f.actors.manager, admin, f.actors.superAdmin]) {
      expect(await errorCode(uploadDocument(db, actor, leadId, { bytes: pdf(), name: "a.pdf" }))).toBe("ok");
    }
    expect(await errorCode(uploadDocument(db, f.actors.agent2, leadId, { bytes: pdf(), name: "a.pdf" }))).toBe("NOT_FOUND");
    for (const actor of [f.actors.hr, accountant]) expect(await errorCode(uploadDocument(db, actor, leadId, { bytes: pdf(), name: "a.pdf" }))).toBe("FORBIDDEN");
    const [doc] = await listDocuments(db, f.actors.agent1, leadId);
    expect((await openDocument(db, f.actors.manager, doc.id)).id).toBe(doc.id);
    expect(await errorCode(openDocument(db, f.actors.outsideAgent, doc.id))).toBe("NOT_FOUND");
    expect(await errorCode(openDocument(db, f.actors.hr, doc.id))).toBe("FORBIDDEN");
    // A document id cannot be fetched as a recording, nor the reverse.
    const mp3 = pad([0x49, 0x44, 0x33, 4, 0, 0]);
    const rec = await uploadRecording(db, f.actors.agent1, leadId, { bytes: mp3, name: "call.mp3" });
    expect(await errorCode(openRecording(db, f.actors.agent1, doc.id))).toBe("NOT_FOUND");
    expect(await errorCode(openDocument(db, f.actors.agent1, rec.id))).toBe("NOT_FOUND");
    // Booked leads are read-only.
    await db.update(leads).set({ stage: "booked" }).where(eq(leads.id, leadId));
    expect(await errorCode(uploadDocument(db, f.actors.agent1, leadId, { bytes: pdf(), name: "a.pdf" }))).toBe("BUSINESS_RULE");
  });
});
