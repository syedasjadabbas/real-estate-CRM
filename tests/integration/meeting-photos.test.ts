import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cancelMeeting, createMeeting } from "@/modules/meetings/commands";
import { listMeetings } from "@/modules/meetings/queries";
import { listMeetingPhotos, openMeetingPhoto, removeMeetingPhoto, sniffPhoto, uploadMeetingPhoto } from "@/modules/meetings/photos";
import { createLead } from "@/modules/leads/commands";
import type { Database } from "@/server/db";
import { auditLogs, meetingHistory } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

/** Smallest real images: a JPEG and a PNG header are enough for the content check. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const TEXT = new TextEncoder().encode("not an image at all, just text");

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
};

describe.skipIf(!hasTestDb)("Meeting photos (owner, 16 Nov 2026)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let meetingId: string;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const lead = await createLead(db, f.actors.agent1, leadInput(f));
    if (lead.outcome !== "created") throw new Error("setup");
    const m = await createMeeting(db, f.actors.agent1, { title: "Site visit", type: "site_visit", startsAt: new Date(Date.now() + 3_600_000).toISOString(), leadId: lead.leadId, organizerId: f.actors.agent1.id });
    meetingId = m.meetingId;
  });

  it("checks the content, not the name", () => {
    expect([sniffPhoto(JPEG), sniffPhoto(PNG), sniffPhoto(TEXT)]).toEqual(["jpg", "png", null]);
  });

  it("the organizer adds photos; Admins see them, other agents don't; recorded in history and audit", async () => {
    const up = await uploadMeetingPhoto(db, f.actors.agent1, meetingId, { bytes: JPEG, name: "visit.jpg" });
    await uploadMeetingPhoto(db, f.actors.agent1, meetingId, { bytes: PNG, name: "plot.png" });

    expect((await listMeetingPhotos(db, f.actors.superAdmin, meetingId)).map((p) => p.name).sort()).toEqual(["plot.png", "visit.jpg"]);
    expect((await openMeetingPhoto(db, f.actors.superAdmin, up.id)).mime).toBe("image/jpeg");
    // Another agent can't open the meeting or its photos.
    expect((await errorOf(listMeetingPhotos(db, f.actors.agent2, meetingId)))?.code).toBe("NOT_FOUND");
    expect((await errorOf(openMeetingPhoto(db, f.actors.agent2, up.id)))?.code).toBe("NOT_FOUND");
    // HR has no meetings at all.
    expect((await errorOf(openMeetingPhoto(db, f.actors.hr, up.id)))?.code).toBe("FORBIDDEN");

    expect((await db.select().from(meetingHistory).where(eq(meetingHistory.action, "photo_upload"))).length).toBe(2);
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "meeting.photo_upload"))).length).toBe(2);
    // The meetings list carries the count.
    expect((await listMeetings(db, f.actors.superAdmin, {})).rows.find((r) => r.id === meetingId)?.photos).toBe(2);
  });

  it("refuses non-images, mismatched names and cancelled meetings", async () => {
    expect((await errorOf(uploadMeetingPhoto(db, f.actors.agent1, meetingId, { bytes: TEXT, name: "x.jpg" })))?.fields?.file).toMatch(/JPG, PNG or WebP/);
    expect((await errorOf(uploadMeetingPhoto(db, f.actors.agent1, meetingId, { bytes: PNG, name: "x.jpg" })))?.fields?.file).toMatch(/does not match/);
    await cancelMeeting(db, f.actors.agent1, meetingId, { note: "client away" });
    expect((await errorOf(uploadMeetingPhoto(db, f.actors.agent1, meetingId, { bytes: JPEG, name: "late.jpg" })))?.code).toBe("BUSINESS_RULE");
  });

  it("the uploader or an Admin removes a photo; it then disappears from the list", async () => {
    const up = await uploadMeetingPhoto(db, f.actors.agent1, meetingId, { bytes: JPEG, name: "wrong.jpg" });
    const mine = await listMeetingPhotos(db, f.actors.agent1, meetingId);
    expect(mine[0].canRemove).toBe(true);
    await removeMeetingPhoto(db, f.actors.superAdmin, up.id);
    expect(await listMeetingPhotos(db, f.actors.superAdmin, meetingId)).toEqual([]);
    expect((await errorOf(openMeetingPhoto(db, f.actors.superAdmin, up.id)))?.code).toBe("NOT_FOUND");
  });
});
