import { describe, expect, it } from "vitest";
import { canEditEmployeeProfiles, canViewEmployees } from "@/modules/employees/policy";
import { employeeListQuerySchema, profileSchema } from "@/modules/employees/validation";
import type { Role } from "@/server/auth/types";

const roles: Role[] = ["super_admin", "admin", "manager", "agent", "hr", "accountant"];
const issues = (input: unknown) => {
  const r = profileSchema.safeParse(input);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join(".") || "form", i.message]));
};

describe("employees policy (HR employees F/F/R/—/F/—)", () => {
  it("lets super admin, admin and HR edit profiles; managers view; nobody else", () => {
    expect(roles.filter((role) => canEditEmployeeProfiles({ role }))).toEqual(["super_admin", "admin", "hr"]);
    expect(roles.filter((role) => canViewEmployees({ role }))).toEqual(["super_admin", "admin", "manager", "hr"]);
  });
});

describe("HR profile validation", () => {
  it("normalises free text and allows clearing fields", () => {
    expect(profileSchema.parse({ designation: "  Senior   Sales Agent ", department: "Sales" })).toEqual({ designation: "Senior Sales Agent", department: "Sales" });
    expect(profileSchema.parse({ designation: "   ", department: null })).toEqual({ designation: null, department: null });
    expect(issues({ department: "x".repeat(101) }).department).toBe("Department: use at most 100 characters");
  });

  it("follows the lead phone rules", () => {
    expect(profileSchema.parse({ phoneCountryCode: "+92", phoneNumber: "0300-1234567" }).phone).toEqual({ countryCode: "+92", national: "3001234567", e164: "+923001234567" });
    expect(profileSchema.parse({ phoneCountryCode: "+92", phoneNumber: "+92 300 1234567" }).phone?.e164).toBe("+923001234567");
    expect(profileSchema.parse({ phoneCountryCode: "+971", phoneNumber: "050 123 4567" }).phone?.e164).toBe("+971501234567");
    expect(profileSchema.parse({ phoneCountryCode: "+92", phoneNumber: "" }).phone).toBeNull();
    expect(issues({ phoneCountryCode: "+92", phoneNumber: "12345" }).phoneNumber).toBe("Enter a valid phone number");
    expect(issues({ phoneCountryCode: "92a", phoneNumber: "3001234567" }).phoneCountryCode).toBe("Invalid country code");
    expect(issues({ phoneCountryCode: "+92", phoneNumber: "1".repeat(26) }).phoneNumber).toBeDefined();
  });

  it("accepts past and future joining dates but rejects invalid ones", () => {
    expect(profileSchema.parse({ joiningDate: "2031-01-15" }).joiningDate).toBe("2031-01-15");
    expect(profileSchema.parse({ joiningDate: "1998-06-01" }).joiningDate).toBe("1998-06-01");
    expect(profileSchema.parse({ joiningDate: "" }).joiningDate).toBeNull();
    expect(issues({ joiningDate: "2026-02-30" }).joiningDate).toBe("Pick a valid date");
    expect(issues({ joiningDate: "1899-12-31" }).joiningDate).toBe("Pick a date between 1900 and 2100");
  });

  it("rejects account fields instead of ignoring them", () => {
    for (const key of ["name", "email", "role", "status", "passwordHash", "annualLeaveDays", "region"]) {
      expect(profileSchema.safeParse({ [key]: "x" }).success).toBe(false);
    }
  });

  it("parses list filters leniently", () => {
    expect(employeeListQuerySchema.parse({ role: "hr", status: "inactive", sort: "joiningDate", dir: "desc", page: "2" })).toMatchObject({ role: "hr", status: "inactive", sort: "joiningDate", dir: "desc", page: 2 });
    expect(employeeListQuerySchema.parse({ role: "boss", status: "x", sort: "?", page: "0" })).toMatchObject({ role: undefined, status: undefined, sort: "name", dir: "asc", page: 1 });
  });
});
