import { describe, expect, it } from "vitest";
import { approvalPathFor, calendarDays, datesOf, overlaps, proratedAllowance } from "@/modules/leave/rules";
import { ROLES } from "@/server/auth/types";

describe("leave rules (questionnaire Q4–Q17)", () => {
  it("counts calendar days inclusively, weekends included (Q8)", () => {
    expect(calendarDays("2026-11-06", "2026-11-09")).toBe(4); // Fri–Mon
    expect(calendarDays("2026-02-27", "2026-03-01")).toBe(3);
    expect(calendarDays("2028-02-28", "2028-03-01")).toBe(3); // leap year
    expect(datesOf("2026-12-30", "2027-01-01")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
  });

  it("gives the full allowance to earlier joiners and none before joining; prorates joiners (provisional, C-10)", () => {
    expect(proratedAllowance(30, null, 2026)).toEqual({ days: 30, prorated: false });
    expect(proratedAllowance(30, "2025-06-01", 2026)).toEqual({ days: 30, prorated: false });
    expect(proratedAllowance(30, "2027-01-15", 2026)).toEqual({ days: 0, prorated: true });
    expect(proratedAllowance(30, "2026-01-01", 2026)).toEqual({ days: 30, prorated: true });
    expect(proratedAllowance(30, "2026-07-02", 2026).days).toBe(15); // 183 / 365 days
    expect(proratedAllowance(30, "2026-12-31", 2026).days).toBe(0); // 0.08 days rounds to 0
  });

  it("routes managers, HR, admins and super admins to Super Admin approval (Q7); others to the staff steps (Q6)", () => {
    expect(ROLES.filter((r) => approvalPathFor(r) === "senior")).toEqual(["super_admin", "admin", "manager", "hr"]);
    expect(ROLES.filter((r) => approvalPathFor(r) === "staff")).toEqual(["agent", "accountant"]);
  });

  it("detects overlapping ranges", () => {
    expect(overlaps({ startDate: "2026-11-01", endDate: "2026-11-05" }, { startDate: "2026-11-05", endDate: "2026-11-06" })).toBe(true);
    expect(overlaps({ startDate: "2026-11-01", endDate: "2026-11-04" }, { startDate: "2026-11-05", endDate: "2026-11-06" })).toBe(false);
  });
});
