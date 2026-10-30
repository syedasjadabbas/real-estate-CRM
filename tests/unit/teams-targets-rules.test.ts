import { describe, expect, it } from "vitest";
import { nextPeriodStart, percent, periodStart, periodWindow } from "@/modules/targets/period";
import { canSetTargetFor, canSetTargets, canViewTargets, targetScope } from "@/modules/targets/policy";
import { setTargetSchema } from "@/modules/targets/validation";
import { addDays, dailyReportEditable, monthDays, rosterEditable } from "@/modules/teams/dates";
import { canManageTeams, canOperateTeam, canViewOwnRoster, canViewTeam, canViewTeams } from "@/modules/teams/policy";
import { createTeamSchema, dailyReportSchema, rosterSchema } from "@/modules/teams/validation";
import type { Role } from "@/server/auth/types";

const roles: Role[] = ["super_admin", "admin", "manager", "agent", "hr", "accountant"];
const T1 = "6f1c2a64-0a52-4b9b-9a0e-6f0d2b1c9e11";
const T2 = "7a1c2a64-0a52-4b9b-9a0e-6f0d2b1c9e12";
const U = "8b1c2a64-0a52-4b9b-9a0e-6f0d2b1c9e13";
// 29 Oct 2026 at 10:59 and 11:00 in Pakistan time (UTC+5).
const before11 = new Date("2026-10-29T05:59:00Z");
const at11 = new Date("2026-10-29T06:00:00Z");

describe("target periods (observed: monthly = 1st, weekly = Monday)", () => {
  it("normalises the anchor date", () => {
    expect(periodStart("monthly", "2026-10-17")).toBe("2026-10-01");
    expect(periodStart("weekly", "2026-10-01")).toBe("2026-09-28");
    expect(periodStart("weekly", "2026-09-28")).toBe("2026-09-28");
    expect(periodStart("weekly", "2026-10-04")).toBe("2026-09-28");
    expect(periodStart("daily", "2026-10-17")).toBe("2026-10-17");
  });
  it("computes the next start and a Pakistan-time window", () => {
    expect(nextPeriodStart("monthly", "2026-12-01")).toBe("2027-01-01");
    expect(nextPeriodStart("weekly", "2026-09-28")).toBe("2026-10-05");
    const w = periodWindow("daily", "2026-10-29");
    expect(w.from.toISOString()).toBe("2026-10-28T19:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-10-29T19:00:00.000Z");
  });
  it("percent floors and has no value without a target or data", () => {
    expect(percent(429, 1300)).toBe(33);
    expect(percent(5, 20)).toBe(25);
    expect(percent(0, 0)).toBeNull();
    expect(percent(null, 10)).toBeNull();
  });
});

describe("locks and dates", () => {
  it("daily reports are editable on their own date only", () => {
    expect(dailyReportEditable("2026-10-29", before11)).toBe(true);
    expect(dailyReportEditable("2026-10-28", before11)).toBe(false);
    expect(dailyReportEditable("2026-10-30", before11)).toBe(false);
  });
  it("roster: future days editable, today until 11:00, past days locked", () => {
    expect(rosterEditable("2026-10-29", before11)).toBe(true);
    expect(rosterEditable("2026-10-29", at11)).toBe(false);
    expect(rosterEditable("2026-10-30", at11)).toBe(true);
    expect(rosterEditable("2026-10-28", before11)).toBe(false);
  });
  it("calendar helpers", () => {
    expect(addDays("2026-10-29", -14)).toBe("2026-10-15");
    expect(monthDays("2026-02")).toHaveLength(28);
    expect(monthDays("2026-10").at(-1)).toBe("2026-10-31");
  });
});

describe("permissions", () => {
  const as = (role: Role, managed: string[] = []) => ({ id: U, role, managedTeamIds: managed });
  it("teams: admins manage; managers operate their own teams; HR reads; agents and accountants none", () => {
    expect(roles.filter((role) => canViewTeams({ role }))).toEqual(["super_admin", "admin", "manager", "hr"]);
    expect(roles.filter((role) => canManageTeams({ role }))).toEqual(["super_admin", "admin"]);
    expect(canOperateTeam(as("manager", [T1]), T1)).toBe(true);
    expect(canOperateTeam(as("manager", [T1]), T2)).toBe(false);
    expect(canViewTeam(as("manager", [T1]), T2)).toBe(false);
    expect(canViewTeam(as("hr"), T2)).toBe(true);
    expect(canOperateTeam(as("hr"), T2)).toBe(false);
    expect(canViewOwnRoster({ role: "agent" })).toBe(true);
  });
  it("targets: set F/F/T/—/—/—, view F/F/T/O/—/—", () => {
    expect(roles.filter((role) => canSetTargets({ role }))).toEqual(["super_admin", "admin", "manager"]);
    expect(roles.filter((role) => canViewTargets({ role }))).toEqual(["super_admin", "admin", "manager", "agent"]);
    expect(roles.map(targetScope)).toEqual(["all", "all", "team", "own", "none", "none"]);
    expect(canSetTargetFor({ role: "manager" }, U, [U])).toBe(true);
    expect(canSetTargetFor({ role: "manager" }, U, [])).toBe(false);
  });
});

describe("validation", () => {
  it("team, daily report, roster and target inputs", () => {
    expect(createTeamSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(createTeamSchema.parse({ name: " North ", managerId: "" })).toEqual({ name: "North", managerId: null, isActive: true });
    expect(dailyReportSchema.safeParse({ lines: [{ agentId: U, leads: -1 }] }).success).toBe(false);
    expect(dailyReportSchema.parse({ lines: [{ agentId: U, leads: "3", calls: "" }] }).lines[0]).toMatchObject({ leads: 3, calls: 0, remarks: null });
    expect(rosterSchema.safeParse({ entries: [{ userId: U, status: "remote" }] }).success).toBe(false);
    expect(setTargetSchema.safeParse({ userId: U, period: "monthly", anchor: "2026-10-01", calls: "1.5" }).success).toBe(false);
    expect(setTargetSchema.parse({ userId: U, period: "weekly", anchor: "2026-10-01", calls: "1,300", meetings: "20", soldSqft: "350.5" })).toMatchObject({ calls: 1300, meetings: 20, soldSqft: 350.5 });
  });
});
