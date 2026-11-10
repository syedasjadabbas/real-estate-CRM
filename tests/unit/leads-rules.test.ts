import { describe, expect, it } from "vitest";
import { generateLeadCode } from "@/modules/leads/code";
import { formatPhone, normalizePhone } from "@/modules/leads/phone";
import { canAccessLead, canAssignTo, canDo, leadScope } from "@/modules/leads/policy";
import { assertStageChange } from "@/modules/leads/rules";
import { leadListQuerySchema, createLeadSchema } from "@/modules/leads/validation";
import { AppError } from "@/server/errors";
import { clearFailures, isLimited, recordFailure } from "@/server/auth/rate-limit";

describe("normalizePhone", () => {
  it.each([
    ["+92", "0300-1234567", "+923001234567"],
    ["92", "300 1234567", "+923001234567"],
    ["+92", "+92 300 1234567", "+923001234567"],
    ["+92", "0092 300 1234567", "+923001234567"],
    ["+966", "053 738 0473", "+966537380473"],
  ])("%s %s → %s", (cc, number, e164) => {
    expect(normalizePhone(cc, number)?.e164).toBe(e164);
  });

  it("rejects numbers that are too short or have a bad country code", () => {
    expect(normalizePhone("+92", "12345")).toBeNull();
    expect(normalizePhone("+0", "3001234567")).toBeNull();
    expect(normalizePhone("abc", "3001234567")).toBeNull();
  });

  it("formats for display", () => {
    expect(formatPhone("+92", "3001234567")).toBe("+92 300 1234567");
  });
});

describe("generateLeadCode", () => {
  it("produces 8 uppercase letters", () => {
    for (let i = 0; i < 50; i += 1) expect(generateLeadCode()).toMatch(/^[A-Z]{8}$/);
  });
});

describe("stage rules", () => {
  const code = (fn: () => void) => {
    try {
      fn();
      return "ok";
    } catch (e) {
      return (e as AppError).code;
    }
  };
  it("allows moving between open stages in any direction", () => {
    expect(code(() => assertStageChange("new_lead", "meeting_done"))).toBe("ok");
    expect(code(() => assertStageChange("meeting_done", "contacted"))).toBe("ok");
    expect(code(() => assertStageChange("lost_lead", "contacted"))).toBe("ok");
  });
  it("blocks no-op, Lost (needs reason) and Booked (Bookings module)", () => {
    expect(code(() => assertStageChange("contacted", "contacted"))).toBe("BUSINESS_RULE");
    expect(code(() => assertStageChange("contacted", "lost_lead"))).toBe("BUSINESS_RULE");
    expect(code(() => assertStageChange("contacted", "booked"))).toBe("BUSINESS_RULE");
    expect(code(() => assertStageChange("booked", "contacted"))).toBe("BUSINESS_RULE");
  });
});

describe("leads policy", () => {
  const agent = { id: "agent", role: "agent" as const };
  const manager = { id: "mgr", role: "manager" as const };
  const admin = { id: "adm", role: "admin" as const };
  const hr = { id: "hr", role: "hr" as const };

  it("maps roles to scopes", () => {
    expect(leadScope("super_admin")).toBe("all");
    expect(leadScope("manager")).toBe("team");
    expect(leadScope("agent")).toBe("own");
    expect(leadScope("accountant")).toBe("none");
  });

  it("agents see only their own leads", () => {
    expect(canAccessLead(agent, "agent")).toBe(true);
    expect(canAccessLead(agent, "someone-else")).toBe(false);
    expect(canAccessLead(agent, null)).toBe(false);
  });

  it("managers see their own and their team's leads only", () => {
    expect(canAccessLead(manager, "a1", ["a1", "a2"])).toBe(true);
    expect(canAccessLead(manager, "mgr", [])).toBe(true);
    expect(canAccessLead(manager, "outsider", ["a1"])).toBe(false);
    expect(canAccessLead(manager, null, ["a1"])).toBe(false);
  });

  it("admins see everything; HR sees nothing", () => {
    expect(canAccessLead(admin, null)).toBe(true);
    expect(canAccessLead(hr, "hr")).toBe(false);
  });

  it("restricts actions by role", () => {
    expect(canDo(agent, "assign")).toBe(false);
    expect(canDo(agent, "markLostDirect")).toBe(false);
    expect(canDo(agent, "requestLost")).toBe(true);
    expect(canDo(manager, "decideLost")).toBe(true);
    expect(canDo(hr, "view")).toBe(false);
  });

  it("limits who can be assigned", () => {
    expect(canAssignTo(manager, "a1", ["a1"])).toBe(true);
    expect(canAssignTo(manager, "outsider", ["a1"])).toBe(false);
    expect(canAssignTo(agent, "agent")).toBe(false);
    expect(canAssignTo(admin, "anyone")).toBe(true);
  });
});

describe("validation", () => {
  it("rejects a lead without required fields", () => {
    const result = createLeadSchema.safeParse({ name: "", phoneCountryCode: "+92", phoneNumber: "" });
    expect(result.success).toBe(false);
  });

  it("falls back to defaults for invalid list params", () => {
    const q = leadListQuerySchema.parse({ view: "bogus", page: "-4", sort: "drop table", stage: "contacted,nope" });
    expect(q.view).toBe("all");
    expect(q.page).toBe(1);
    expect(q.sort).toBeUndefined(); // the query applies the default, so the Regenerated view can tell none was chosen
    expect(q.stage).toEqual([]);
  });

  it("parses multi-value filters", () => {
    const q = leadListQuerySchema.parse({ stage: "contacted,qualified_lead", priority: ["high"] });
    expect(q.stage).toEqual(["contacted", "qualified_lead"]);
    expect(q.priority).toEqual(["high"]);
  });
});

describe("login rate limit", () => {
  it("locks after 5 failures within the window", () => {
    const key = "user@test|1.2.3.4";
    clearFailures(key);
    for (let i = 0; i < 5; i += 1) recordFailure(key, 1_000);
    expect(isLimited(key, 1_000)).toBe(true);
    expect(isLimited(key, 1_000 + 16 * 60 * 1000)).toBe(false);
    clearFailures(key);
  });
});

describe("AppError", () => {
  it("maps codes to HTTP status", () => {
    expect(new AppError("NOT_FOUND", "x").status).toBe(404);
    expect(new AppError("CONFLICT", "x").status).toBe(409);
  });
});
