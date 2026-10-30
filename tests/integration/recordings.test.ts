import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLead } from "@/modules/leads/commands";
import { listRecordings, openRecording, uploadRecording } from "@/modules/recordings/service";
import { auditLogs, files, leadActivities, leads, users } from "@/server/db/schema";
import { loadActor } from "@/server/auth/session-store";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { readObject } from "@/server/storage/local";
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

/** A small but valid-looking MP3 (ID3 header + padding). */
const mp3 = (size = 2048) => {
  const b = new Uint8Array(size);
  b.set([0x49, 0x44, 0x33, 0x04, 0, 0]);
  return b;
};
const wav = () => {
  const b = new Uint8Array(512);
  b.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
  b.set([..."WAVE"].map((c) => c.charCodeAt(0)), 8);
  return b;
};

describe.skipIf(!hasTestDb)("Call recordings (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let admin: Actor;
  let accountant: Actor;
  let storageDir: string;
  let leadId: string;

  const storedFiles = async () => {
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
    storageDir = await mkdtemp(path.join(tmpdir(), "mz-recordings-"));
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

  describe("upload", () => {
    it("stores the file privately, records metadata, timeline, audit and first touch", async () => {
      const bytes = mp3();
      const r = await uploadRecording(db, f.actors.agent1, leadId, { bytes, name: "C:\\calls\\Call 0300.mp3", durationSec: "95.4" });
      expect(r).toMatchObject({ name: "Call 0300.mp3", sizeBytes: 2048, durationSec: 95 });
      const [row] = await db.select().from(files).where(eq(files.id, r.id));
      expect(row).toMatchObject({ leadId, kind: "call_recording", mime: "audio/mpeg", sizeBytes: 2048, durationSec: 95, uploadedById: f.actors.agent1.id });
      expect(row.storageKey).toMatch(/^recordings\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.mp3$/);
      expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
      const onDisk = await storedFiles();
      expect(onDisk).toHaveLength(1);
      expect(new Uint8Array(await readFile(onDisk[0]))).toEqual(bytes);
      expect(onDisk[0].startsWith(storageDir)).toBe(true);
      const [activity] = await db.select().from(leadActivities).where(eq(leadActivities.type, "file_uploaded"));
      expect(activity).toMatchObject({ leadId, actorId: f.actors.agent1.id, body: "Call 0300.mp3" });
      const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, "lead.recording_upload"));
      expect(log).toMatchObject({ actorId: f.actors.agent1.id, entity: "lead", entityId: leadId });
      const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
      expect(lead.firstTouchAt).not.toBeNull();
    });

    it("lets the owner agent, their manager and admins upload; refuses everyone else", async () => {
      for (const actor of [f.actors.agent1, f.actors.manager, admin, f.actors.superAdmin]) {
        expect(await errorCode(uploadRecording(db, actor, leadId, { bytes: mp3(), name: "a.mp3" }))).toBe("ok");
      }
      // Another agent and a manager of another team cannot even see the lead.
      expect(await errorCode(uploadRecording(db, f.actors.agent2, leadId, { bytes: mp3(), name: "a.mp3" }))).toBe("NOT_FOUND");
      expect(await errorCode(uploadRecording(db, f.actors.outsideAgent, leadId, { bytes: mp3(), name: "a.mp3" }))).toBe("NOT_FOUND");
      for (const actor of [f.actors.hr, accountant]) {
        expect(await errorCode(uploadRecording(db, actor, leadId, { bytes: mp3(), name: "a.mp3" }))).toBe("FORBIDDEN");
      }
      expect(await db.select().from(files)).toHaveLength(4);
      expect(await storedFiles()).toHaveLength(4);
    });

    it("rejects empty, oversized, wrong-type and disguised files and stores nothing", async () => {
      const cases: [Uint8Array, string][] = [
        [new Uint8Array(0), "a.mp3"],
        [mp3(25 * 1024 * 1024 + 1), "a.mp3"],
        [mp3(), "a.exe"],
        [mp3(), "a"],
        [wav(), "a.mp3"], // WAV content named .mp3
        [new TextEncoder().encode("<html><script>alert(1)</script></html>"), "a.mp3"],
        [new TextEncoder().encode("#!AMR\n0000000000"), "a.amr"],
      ];
      for (const [bytes, name] of cases) {
        const err = await uploadRecording(db, f.actors.agent1, leadId, { bytes, name }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("VALIDATION_FAILED");
        expect(Object.keys((err as AppError).fields ?? {})).toEqual(["file"]);
      }
      expect(await errorCode(uploadRecording(db, f.actors.agent1, leadId, { bytes: mp3(25 * 1024 * 1024), name: "max.mp3" }))).toBe("ok");
      expect(await db.select().from(files)).toHaveLength(1);
      expect(await storedFiles()).toHaveLength(1);
    });

    it("refuses booked leads, unknown and malformed ids", async () => {
      await db.update(leads).set({ stage: "booked" }).where(eq(leads.id, leadId));
      expect(await errorCode(uploadRecording(db, f.actors.agent1, leadId, { bytes: mp3(), name: "a.mp3" }))).toBe("BUSINESS_RULE");
      expect(await errorCode(uploadRecording(db, admin, "00000000-0000-4000-8000-000000000000", { bytes: mp3(), name: "a.mp3" }))).toBe("NOT_FOUND");
      expect(await errorCode(uploadRecording(db, admin, "../x", { bytes: mp3(), name: "a.mp3" }))).toBe("NOT_FOUND");
      expect(await storedFiles()).toHaveLength(0);
    });

    it("ignores a browser duration that is out of range", async () => {
      const r = await uploadRecording(db, f.actors.agent1, leadId, { bytes: wav(), name: "a.wav", durationSec: "999999" });
      expect(r.durationSec).toBeNull();
    });
  });

  describe("listing and playback access", () => {
    it("shows recordings to whoever may view the lead and 404s for everyone else", async () => {
      const { id } = await uploadRecording(db, f.actors.agent1, leadId, { bytes: mp3(), name: "first.mp3" });
      await uploadRecording(db, f.actors.manager, leadId, { bytes: wav(), name: "second.wav" });
      const list = await listRecordings(db, f.actors.agent1, leadId);
      expect(list.map((r) => r.name)).toEqual(["second.wav", "first.mp3"]);
      expect(list[1]).toMatchObject({ uploadedBy: "Agent A", mime: "audio/mpeg" });

      for (const actor of [f.actors.agent1, f.actors.manager, admin, f.actors.superAdmin]) {
        expect((await openRecording(db, actor, id)).id).toBe(id);
      }
      for (const actor of [f.actors.agent2, f.actors.outsideAgent]) {
        expect(await errorCode(openRecording(db, actor, id))).toBe("NOT_FOUND");
        expect(await errorCode(listRecordings(db, actor, leadId))).toBe("NOT_FOUND");
      }
      for (const actor of [f.actors.hr, accountant]) {
        expect(await errorCode(openRecording(db, actor, id))).toBe("FORBIDDEN");
        expect(await errorCode(listRecordings(db, actor, leadId))).toBe("FORBIDDEN");
      }
      expect(await errorCode(openRecording(db, admin, "00000000-0000-4000-8000-000000000000"))).toBe("NOT_FOUND");
      expect(await errorCode(openRecording(db, admin, "not-an-id"))).toBe("NOT_FOUND");
    });

    it("streams exactly the stored bytes, whole or by range", async () => {
      const bytes = mp3(4096);
      bytes[4000] = 7;
      const { id } = await uploadRecording(db, f.actors.agent1, leadId, { bytes, name: "a.mp3" });
      const file = await openRecording(db, f.actors.agent1, id);
      const whole = new Uint8Array(await new Response(readObject(file.storageKey)).arrayBuffer());
      expect(whole).toEqual(bytes);
      const part = new Uint8Array(await new Response(readObject(file.storageKey, { start: 3999, end: 4001 })).arrayBuffer());
      expect([...part]).toEqual([0, 7, 0]);
    });
  });

  it("enforces size, duration and name rules in the database too", async () => {
    const base = { leadId, kind: "call_recording" as const, mime: "audio/mpeg", sha256: "x", originalName: "a.mp3" };
    await expect(db.insert(files).values({ ...base, storageKey: "k1", sizeBytes: 0 })).rejects.toThrow();
    await expect(db.insert(files).values({ ...base, storageKey: "k2", sizeBytes: 1, durationSec: -1 })).rejects.toThrow();
    await expect(db.insert(files).values({ ...base, storageKey: "k3", sizeBytes: 1, originalName: "" })).rejects.toThrow();
    await db.insert(files).values({ ...base, storageKey: "k4", sizeBytes: 1 });
    await expect(db.insert(files).values({ ...base, storageKey: "k4", sizeBytes: 1 })).rejects.toThrow();
  });
});
