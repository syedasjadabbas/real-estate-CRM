import { describe, expect, it } from "vitest";
import { canManageHolidays, canViewHolidays } from "@/modules/holidays/policy";
import { createHolidaySchema, holidayListQuerySchema, regionIssue, updateHolidaySchema, weekdayOf } from "@/modules/holidays/validation";
import type { Role } from "@/server/auth/types";

const roles: Role[] = ["super_admin", "admin", "manager", "agent", "hr", "accountant"];
const issues = (input: unknown) => {
  const r = createHolidaySchema.safeParse(input);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
};

describe("holidays policy (HR employees / holidays F/F/R/—/F/—)", () => {
  it("lets HR and admins manage, managers view, and nobody else in", () => {
    expect(roles.filter((role) => canManageHolidays({ role }))).toEqual(["super_admin", "admin", "hr"]);
    expect(roles.filter((role) => canViewHolidays({ role }))).toEqual(["super_admin", "admin", "manager", "hr"]);
  });
});

describe("holiday validation", () => {
  it("accepts a company-wide holiday and normalises the name", () => {
    const r = createHolidaySchema.parse({ date: "2026-12-25", name: "  Quaid-e-Azam   Day " });
    expect(r).toEqual({ date: "2026-12-25", name: "Quaid-e-Azam Day", scope: "company", region: null });
  });

  it("requires a real calendar date within the accepted years", () => {
    expect(issues({ name: "Holiday" }).date).toBeDefined();
    expect(issues({ date: "", name: "Holiday" }).date).toBe("Pick a date");
    expect(issues({ date: "2026-02-30", name: "Holiday" }).date).toBe("Pick a valid date");
    expect(issues({ date: "2026-13-01", name: "Holiday" }).date).toBe("Pick a valid date");
    expect(issues({ date: "25/12/2026", name: "Holiday" }).date).toBe("Pick a valid date");
    expect(issues({ date: "1999-12-31", name: "Holiday" }).date).toBe("Pick a date between 2000 and 2100");
    expect(issues({ date: "2101-01-01", name: "Holiday" }).date).toBe("Pick a date between 2000 and 2100");
    // Leap days are valid only in leap years.
    expect(issues({ date: "2028-02-29", name: "Holiday" })).toEqual({});
    expect(issues({ date: "2027-02-29", name: "Holiday" }).date).toBe("Pick a valid date");
  });

  it("checks the name length", () => {
    expect(issues({ date: "2026-01-01" }).name).toBe("Name is required");
    expect(issues({ date: "2026-01-01", name: "   " }).name).toBe("Use at least 2 characters");
    expect(issues({ date: "2026-01-01", name: "x".repeat(101) }).name).toBe("Use at most 100 characters");
  });

  it("ties the region to the scope", () => {
    expect(issues({ date: "2026-01-01", name: "Holiday", scope: "regional" }).region).toBe("Enter the region for a regional holiday");
    expect(issues({ date: "2026-01-01", name: "Holiday", scope: "regional", region: "  " }).region).toBe("Enter the region for a regional holiday");
    expect(issues({ date: "2026-01-01", name: "Holiday", scope: "company", region: "Lahore" }).region).toBe("Company-wide holidays have no region");
    expect(issues({ date: "2026-01-01", name: "Holiday", scope: "other" }).scope).toBeDefined();
    expect(createHolidaySchema.parse({ date: "2026-01-01", name: "Holiday", scope: "regional", region: " Gilgit  Baltistan " }).region).toBe("Gilgit Baltistan");
    expect(regionIssue("regional", "L")).toBe("Use at least 2 characters");
    expect(regionIssue("company", null)).toBeNull();
  });

  it("allows partial updates without defaults", () => {
    expect(updateHolidaySchema.parse({ name: "New name" })).toEqual({ name: "New name" });
    expect(updateHolidaySchema.safeParse({ date: "2026-02-30" }).success).toBe(false);
  });

  it("parses list filters leniently", () => {
    expect(holidayListQuerySchema.parse({ year: "2027", scope: "regional", sort: "name", dir: "desc" })).toMatchObject({ year: 2027, scope: "regional", sort: "name", dir: "desc" });
    expect(holidayListQuerySchema.parse({ year: "abc", scope: "x", sort: "?", dir: "?" })).toEqual({ year: undefined, scope: undefined, region: undefined, q: undefined, sort: "date", dir: "asc" });
    expect(holidayListQuerySchema.parse({ year: "1990" }).year).toBeUndefined();
  });

  it("names the weekday without time zone drift", () => {
    expect(weekdayOf("2026-12-25")).toBe("Friday");
    expect(weekdayOf("2026-01-01")).toBe("Thursday");
    expect(weekdayOf("2028-02-29")).toBe("Tuesday");
  });
});
