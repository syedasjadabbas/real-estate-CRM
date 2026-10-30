import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { businessToday } from "@/modules/bookings/today";
import { listHolidays, upcomingHolidays } from "@/modules/holidays/service";
import { getMyWorkplace, listMySignins } from "@/modules/workplace/service";
import { createSession, loadActor, revokeSession } from "@/server/auth/session-store";
import { holidays, signinLogs, users } from "@/server/db/schema";
import type { Database } from "@/server/db";
import type { Actor } from "@/server/auth/types";
import { AppError } from "@/server/errors";
import { connectTestDb, hasTestDb, resetDb, seedFixture, type Fixture } from "../support/db";

const errorCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
};

const DAY = 86_400_000;

describe.skipIf(!hasTestDb)("My Workplace (PostgreSQL integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let f: Fixture;
  let admin: Actor;
  let accountant: Actor;
  let everyone: Actor[];

  beforeAll(() => {
    ({ db, close } = connectTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetDb(db);
    f = await seedFixture(db);
    const mk = async (role: "admin" | "accountant", email: string) => {
      const [u] = await db.insert(users).values({ name: role, email, role, passwordHash: "x" }).returning();
      return loadActor(db, { id: u.id, name: u.name, email: u.email, role: u.role });
    };
    admin = await mk("admin", "admin@test.local");
    accountant = await mk("accountant", "acc@test.local");
    everyone = [f.actors.superAdmin, admin, f.actors.manager, f.actors.agent1, f.actors.hr, accountant];
  });

  const log = (userId: string, at: Date, event: "sign_in" | "sign_out" = "sign_in", ip: string | null = "203.0.113.7") =>
    db.insert(signinLogs).values({ userId, at, event, ip, userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/141.0 Safari/537.36" });

  describe("sign-in history", () => {
    it("shows each of the six roles only their own rows", async () => {
      for (const [i, actor] of everyone.entries()) {
        for (let n = 0; n <= i; n++) await log(actor.id, new Date(Date.now() - n * 60_000));
      }
      for (const [i, actor] of everyone.entries()) {
        const r = await listMySignins(db, actor);
        expect(r.total).toBe(i + 1);
        expect(r.recentSignins).toBe(i + 1);
      }
      // A user with no rows sees an empty log, not anyone else's.
      const empty = await listMySignins(db, f.actors.agent2);
      expect(empty).toMatchObject({ total: 0, rows: [], recentSignins: 0, page: 1, pageCount: 1 });
    });

    it("rejects any parameter naming another user (no silent fallback)", async () => {
      await log(f.actors.agent2.id, new Date());
      for (const key of ["userId", "user_id", "user", "employeeId", "agentId"]) {
        expect(await errorCode(listMySignins(db, f.actors.agent1, { [key]: f.actors.agent2.id }))).toBe("VALIDATION_FAILED");
        expect(await errorCode(getMyWorkplace(db, f.actors.superAdmin, { [key]: f.actors.agent2.id }))).toBe("VALIDATION_FAILED");
      }
    });

    it("lists newest first with the event filter, pagination and stored values as recorded", async () => {
      const now = Date.now();
      for (let n = 0; n < 30; n++) await log(f.actors.agent1.id, new Date(now - n * 60_000), n % 2 ? "sign_out" : "sign_in");
      await db.insert(signinLogs).values({ userId: f.actors.agent1.id, at: new Date(now - DAY), event: "sign_in", ip: null, userAgent: null });
      const first = await listMySignins(db, f.actors.agent1);
      expect(first).toMatchObject({ total: 31, pageCount: 2, page: 1 });
      expect(first.rows).toHaveLength(25);
      expect(first.rows[0]).toMatchObject({ event: "sign_in", ip: "203.0.113.7", browser: "Chrome · Windows" });
      expect(first.rows.map((r) => r.at.getTime())).toEqual([...first.rows.map((r) => r.at.getTime())].sort((a, b) => b - a));
      const second = await listMySignins(db, f.actors.agent1, { page: "2" });
      expect(second.rows).toHaveLength(6);
      expect(second.rows.at(-1)).toMatchObject({ ip: null, userAgent: null, browser: "Unknown browser" });
      expect((await listMySignins(db, f.actors.agent1, { event: "sign_out" })).total).toBe(15);
      expect((await listMySignins(db, f.actors.agent1, { event: "sign_in" })).total).toBe(16);
      expect((await listMySignins(db, f.actors.agent1, { page: "99" })).page).toBe(2);
      // Rows carry only what was stored: no durations, sessions or locations.
      expect(Object.keys(first.rows[0]).sort()).toEqual(["at", "browser", "event", "id", "ip", "userAgent"]);
    });

    it("counts only own sign-ins in the last 30 days", async () => {
      const now = Date.now();
      await log(f.actors.agent1.id, new Date(now - 29 * DAY));
      await log(f.actors.agent1.id, new Date(now - 31 * DAY));
      await log(f.actors.agent1.id, new Date(now - DAY), "sign_out");
      await log(f.actors.agent2.id, new Date(now - DAY));
      const r = await listMySignins(db, f.actors.agent1);
      expect(r.recentSignins).toBe(1);
      expect(r.total).toBe(3);
    });

    it("shows real sign-in and sign-out events written by the existing auth code", async () => {
      const { token } = await createSession(db, f.actors.hr.id, { ip: "198.51.100.4", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Version/18.0 Safari/605.1.15" });
      await revokeSession(db, token, { ip: "198.51.100.4", userAgent: null });
      const r = await listMySignins(db, f.actors.hr);
      expect(r.rows.map((x) => x.event).sort()).toEqual(["sign_in", "sign_out"]);
      expect(r.rows.find((x) => x.event === "sign_in")).toMatchObject({ ip: "198.51.100.4", browser: "Safari · macOS" });
      expect(r.recentSignins).toBe(1);
    });
  });

  describe("upcoming holidays", () => {
    const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

    it("includes today and excludes yesterday (Pakistan time), ordered date then company first, limited to 10", async () => {
      const today = businessToday();
      await db.insert(holidays).values([
        { date: addDays(today, -1), name: "Yesterday", scope: "company" },
        { date: today, name: "Today Regional", scope: "regional", region: "Lahore" },
        { date: today, name: "Today Company", scope: "company" },
        ...Array.from({ length: 12 }, (_, i) => ({ date: addDays(today, i + 2), name: `Later ${i}`, scope: "company" as const })),
      ]);
      const r = await upcomingHolidays(db);
      expect(r.today).toBe(today);
      expect(r.rows).toHaveLength(10);
      expect(r.rows.slice(0, 2).map((h) => [h.name, h.region, h.daysAway])).toEqual([
        ["Today Company", null, 0],
        ["Today Regional", "Lahore", 0],
      ]);
      expect(r.rows.map((h) => h.name)).not.toContain("Yesterday");
      expect(r.rows[2].daysAway).toBe(2);
      // Calendar facts only.
      expect(Object.keys(r.rows[0]).sort()).toEqual(["date", "daysAway", "id", "name", "region", "scope"]);
    });

    it("uses the business date, not UTC: just after midnight in Karachi is already the next day", async () => {
      // 19:30 UTC on 30 Oct is 00:30 on 31 Oct in Asia/Karachi (UTC+5).
      const karachiToday = businessToday(new Date("2026-10-30T19:30:00Z"));
      expect(karachiToday).toBe("2026-10-31");
      await db.insert(holidays).values([
        { date: "2026-10-30", name: "Gone", scope: "company" },
        { date: "2026-10-31", name: "Here", scope: "company" },
      ]);
      expect((await upcomingHolidays(db, { today: karachiToday })).rows.map((h) => h.name)).toEqual(["Here"]);
    });

    it("is visible to all six roles via My Workplace, while the HR Holidays page rule is unchanged", async () => {
      await db.insert(holidays).values({ date: addDays(businessToday(), 5), name: "Regional Day", scope: "regional", region: "Karachi" });
      for (const actor of everyone) {
        const w = await getMyWorkplace(db, actor);
        expect(w.holidays.rows.map((h) => h.name)).toEqual(["Regional Day"]);
        expect(w.leave).toEqual({ status: "pending_client_decision" });
      }
      expect(await errorCode(listHolidays(db, f.actors.agent1))).toBe("FORBIDDEN");
      expect(await errorCode(listHolidays(db, accountant))).toBe("FORBIDDEN");
    });

    it("returns an empty list when nothing is scheduled", async () => {
      expect((await upcomingHolidays(db)).rows).toEqual([]);
    });
  });
});
