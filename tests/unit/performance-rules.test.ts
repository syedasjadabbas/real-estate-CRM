import { describe, expect, it } from "vitest";
import { callMinutes, NO_CALLS, QUALIFIED_CALL_SEC, VERIFIED_CALL_SEC } from "@/modules/performance/calls";
import { PERFORMANCE_SORTS, pct, performanceQuerySchema, resolveRange } from "@/modules/performance/range";
import { canViewPerformance } from "@/modules/performance/service";
import type { Role } from "@/server/auth/types";

const NOW = new Date("2026-10-29T05:00:00Z"); // 29 Oct 2026, 10:00 Pakistan time

describe("performance range (observed default: last 30 days)", () => {
  it("defaults to the last 30 days, inclusive, in Pakistan time", () => {
    const r = resolveRange(undefined, undefined, NOW);
    expect([r.from, r.to]).toEqual(["2026-09-29", "2026-10-29"]);
    expect(r.window.start.toISOString()).toBe("2026-09-28T19:00:00.000Z");
    expect(r.window.end.toISOString()).toBe("2026-10-29T19:00:00.000Z");
  });
  it("swaps a reversed range and clamps spans over a year", () => {
    expect(resolveRange("2026-10-20", "2026-10-01", NOW)).toMatchObject({ from: "2026-10-01", to: "2026-10-20" });
    expect(resolveRange("2020-01-01", "2026-10-29", NOW).from).toBe("2025-10-28");
  });
  it("invalid query values fall back to safe defaults", () => {
    expect(performanceQuerySchema.parse({ from: "nope", sort: "x", dir: "y", page: "-1", team: "bad" })).toEqual({ from: undefined, to: undefined, team: undefined, sort: "agent", dir: "asc", page: 1 });
  });
});

describe("percentages and roles", () => {
  it("pct rounds and has no value without a denominator", () => {
    expect(pct(348, 513)).toBe(68);
    expect(pct(0, 53)).toBe(0);
    expect(pct(0, 0)).toBeNull();
  });
  it("Performance F/F/T/O/—/—", () => {
    const roles: Role[] = ["super_admin", "admin", "manager", "agent", "hr", "accountant"];
    expect(roles.filter((role) => canViewPerformance({ role }))).toEqual(["super_admin", "admin", "manager", "agent"]);
  });
});

describe("calls = uploaded call recordings (client confirmation 10 Nov 2026)", () => {
  it("FR-152 thresholds: verified from 30 s, qualified from 60 s", () => {
    expect([VERIFIED_CALL_SEC, QUALIFIED_CALL_SEC]).toEqual([30, 60]);
  });
  it("call minutes add up stored durations, and have no value when no call has one", () => {
    expect(callMinutes({ timed: 5, seconds: 284 })).toBe(5);
    expect(callMinutes({ timed: 1, seconds: 29 })).toBe(0);
    expect(callMinutes({ timed: 0, seconds: 0 })).toBeNull();
    expect(callMinutes(NO_CALLS)).toBeNull();
  });
  it("Calls and Call min are sortable columns", () => {
    expect(PERFORMANCE_SORTS).toEqual(expect.arrayContaining(["calls", "callMin"]));
    expect(performanceQuerySchema.parse({ sort: "callMin", dir: "desc" })).toMatchObject({ sort: "callMin", dir: "desc" });
  });
});
