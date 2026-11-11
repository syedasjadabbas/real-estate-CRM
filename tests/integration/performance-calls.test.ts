import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLead } from "@/modules/leads/commands";
import { performanceCsv, performanceReport } from "@/modules/performance/service";
import { files, leads, meetings } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { connectTestDb, hasTestDb, leadInput, resetDb, seedFixture, type Fixture } from "../support/db";

/**
 * Calls on the Performance page (client confirmation 10 Nov 2026): a call is a `files` row with kind
 * 'call_recording', a lead and no deleted_at, attributed to its uploader and counted by upload time.
 * Call min = stored durations / 60; FR-152 buckets: ≥ 30 s verified, ≥ 60 s qualified.
 */

// Range 1–29 Oct 2026 in Pakistan time = [2026-09-30T19:00Z, 2026-10-29T19:00Z).
const NOW = new Date("2026-10-29T05:00:00Z");
const RANGE = { from: "2026-10-01", to: "2026-10-29" };
const INSIDE = new Date("2026-10-10T07:00:00Z");
const FIRST_MOMENT = new Date("2026-09-30T19:00:00Z");
const JUST_BEFORE = new Date("2026-09-30T18:59:59Z");
const LAST_MOMENT = new Date("2026-10-29T18:59:59Z");
const JUST_AFTER = new Date("2026-10-29T19:00:00Z");

describe.skipIf(!hasTestDb)("Performance calls from call recordings (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let leadId: string;
  let key = 0;

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const r = await createLead(db, f.actors.agent1, leadInput(f));
    if (r.outcome !== "created") throw new Error("setup");
    leadId = r.leadId;
    // Keep the lead itself out of the range so only call columns change.
    await db.update(leads).set({ createdAt: JUST_AFTER }).where(eq(leads.id, leadId));
  });

  const recording = (uploader: Actor, createdAt: Date, durationSec: number | null, extra: Partial<typeof files.$inferInsert> = {}) =>
    db.insert(files).values({
      leadId,
      kind: "call_recording",
      storageKey: `recordings/perf-${key++}.mp3`,
      originalName: "call.mp3",
      mime: "audio/mpeg",
      sizeBytes: 1,
      sha256: "x",
      durationSec,
      uploadedById: uploader.id,
      createdAt,
      ...extra,
    });
  const report = (actor: Actor, q: Record<string, string> = {}) => performanceReport(db, actor, { ...RANGE, ...q }, NOW);
  const row = (r: Awaited<ReturnType<typeof performanceReport>>, userId: string) => r.allRows.find((x) => x.userId === userId)!;

  it("counts recordings by uploader and upload time, with minutes and FR-152 buckets from stored durations", async () => {
    const a = f.actors.agent1;
    await recording(a, FIRST_MOMENT, 10); // too short for a bucket
    await recording(a, INSIDE, 30); // verified (boundary)
    await recording(a, INSIDE, 59); // verified
    await recording(a, INSIDE, 60); // qualified (boundary)
    await recording(a, LAST_MOMENT, 125); // qualified
    await recording(a, INSIDE, null); // a call, but in no bucket and no minutes
    await recording(a, JUST_BEFORE, 300); // outside
    await recording(a, JUST_AFTER, 300); // outside
    await recording(a, INSIDE, 300, { deletedAt: new Date() }); // hidden by a Super Admin
    await recording(a, INSIDE, 300, { kind: "document", mime: "application/pdf", originalName: "d.pdf" }); // not a recording
    await recording(f.actors.manager, INSIDE, 300); // uploaded by the manager: not the agent's call

    const r = await report(f.actors.superAdmin);
    // 10 + 30 + 59 + 60 + 125 = 284 s = 4.73 min, rounded to 5.
    expect(row(r, a.id)).toMatchObject({ calls: 6, callsTimed: 5, callSeconds: 284, callMin: 5, callsVerified: 4, callsQualified: 2 });
    expect(row(r, f.actors.agent2.id)).toMatchObject({ calls: 0, callMin: null, callsVerified: 0, callsQualified: 0 });
    expect(r.summary).toMatchObject({ calls: 6, callMin: 5, perAgent: { calls: 2 } });
    expect(r.charts.callQuality).toEqual({
      calls: 6,
      timed: 5,
      verified: 4,
      qualified: 2,
      callMin: 5,
      verifiedPct: 80,
      qualifiedPct: 40,
      rows: [{ userId: a.id, name: "Agent A", calls: 6, timed: 5, verified: 4, qualified: 2 }],
    });
    expect(r.charts.callVolume).toEqual([{ userId: a.id, name: "Agent A", calls: 6, callMin: 5 }]);
  });

  it("Call min is empty (—) when no recording in the range has a duration; CSV fills Calls / Call min", async () => {
    await recording(f.actors.agent2, INSIDE, null);
    await recording(f.actors.agent2, INSIDE, null);
    await recording(f.actors.agent1, INSIDE, 90);
    const r = await report(f.actors.superAdmin, { sort: "calls", dir: "desc" });
    expect(row(r, f.actors.agent2.id)).toMatchObject({ calls: 2, callsTimed: 0, callMin: null, callsVerified: 0, callsQualified: 0 });
    expect(r.rows.map((x) => [x.name, x.calls])).toEqual([["Agent B", 2], ["Agent A", 1], ["Agent Outside", 0]]);
    const csv = performanceCsv(r).split("\n");
    expect(csv[1]).toBe("Agent B,2026-10-01,2026-10-29,0,0,0,,2,,0,0,,0,0,0,");
    expect(csv[2]).toBe("Agent A,2026-10-01,2026-10-29,0,0,0,,1,2,0,0,,0,0,0,");
    // Missing call minutes sort last either way.
    const byMin = await report(f.actors.superAdmin, { sort: "callMin", dir: "asc" });
    expect(byMin.rows.map((x) => x.callMin)).toEqual([2, null, null]);
    expect(byMin.charts.callQuality).toMatchObject({ calls: 3, timed: 1, verified: 1, qualified: 1, verifiedPct: 100 });
  });

  it("calls vs meetings ranks agents by combined activity", async () => {
    await recording(f.actors.agent2, INSIDE, 40);
    await recording(f.actors.agent2, INSIDE, 40);
    await recording(f.actors.agent1, INSIDE, 40);
    await db.insert(meetings).values([
      { title: "M1", leadId, organizerId: f.actors.agent1.id, startsAt: INSIDE, status: "completed", completedAt: INSIDE },
      { title: "M2", leadId, organizerId: f.actors.agent1.id, startsAt: INSIDE, status: "completed", completedAt: INSIDE },
    ]);
    const r = await report(f.actors.superAdmin);
    expect(r.charts.callsVsMeetings).toEqual([
      { userId: f.actors.agent1.id, name: "Agent A", calls: 1, meetings: 2 },
      { userId: f.actors.agent2.id, name: "Agent B", calls: 2, meetings: 0 },
    ]);
    expect(r.charts.callVolume.map((x) => x.name)).toEqual(["Agent B", "Agent A"]);
  });

  it("respects the Performance scope: managers see their teams' agents' calls, agents only their own", async () => {
    await recording(f.actors.agent1, INSIDE, 60);
    await recording(f.actors.agent2, INSIDE, 60);
    await recording(f.actors.outsideAgent, INSIDE, 60);
    const mgr = await report(f.actors.manager);
    expect(mgr.summary.calls).toBe(2);
    expect(mgr.charts.callQuality.rows.map((x) => x.name)).toEqual(["Agent A", "Agent B"]);
    const own = await report(f.actors.agent1);
    expect(own.summary.calls).toBe(1);
    expect(own.charts.callVolume.map((x) => x.name)).toEqual(["Agent A"]);
    expect((await report(f.actors.superAdmin)).summary.calls).toBe(3);
  });
});
