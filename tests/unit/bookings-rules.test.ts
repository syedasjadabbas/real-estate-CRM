import { describe, expect, it } from "vitest";
import { FORWARD_PATH, HOLD_DAYS, HOLD_STAGES, nextStage } from "@/modules/bookings/constants";
import { addDays, defaultHoldUntil } from "@/modules/bookings/today";
import { bookingScope, canDoBooking, canMoveTo } from "@/modules/bookings/policy";
import { advanceSchema, cancelSchema, createBookingSchema, updateBookingSchema } from "@/modules/bookings/validation";
import type { Role } from "@/server/auth/types";

const roles: Role[] = ["super_admin", "admin", "manager", "agent", "hr", "accountant"];
const ID = "6f1c2a64-0a52-4b9b-9a0e-6f0d2b1c9e11";

describe("booking stages", () => {
  it("has the reference order and moves one step at a time; closed stages have no next", () => {
    expect(FORWARD_PATH[0]).toBe("negotiation");
    expect(FORWARD_PATH.at(-1)).toBe("confirmed");
    expect(nextStage("negotiation")).toBe("token_pending");
    expect(nextStage("agreement_pending")).toBe("confirmed");
    expect(nextStage("confirmed")).toBeNull();
    expect(nextStage("cancelled")).toBeNull();
  });
});

describe("booking policy (proposed matrix, approved)", () => {
  it("maps roles to actions and scopes", () => {
    expect(roles.filter((role) => canDoBooking({ role }, "create"))).toEqual(["super_admin", "admin", "manager", "agent"]);
    expect(roles.filter((role) => canDoBooking({ role }, "cancel"))).toEqual(["super_admin", "admin", "manager"]);
    expect(roles.filter((role) => canDoBooking({ role }, "view"))).toEqual(["super_admin", "admin", "manager", "agent", "accountant"]);
    expect(roles.map((role) => bookingScope(role))).toEqual(["all", "all", "team", "own", "none", "all"]);
  });

  it("lets agents move up to Sales order only, and only managers / admins confirm", () => {
    expect(canMoveTo({ role: "agent" }, "sales_order")).toBe(true);
    expect(canMoveTo({ role: "agent" }, "booking_form")).toBe(false);
    expect(canMoveTo({ role: "agent" }, "confirmed")).toBe(false);
    expect(canMoveTo({ role: "manager" }, "confirmed")).toBe(true);
    expect(canMoveTo({ role: "accountant" }, "token_pending")).toBe(false);
  });
});

describe("booking validation", () => {
  it("requires positive rate and token and valid ids; parses thousands separators", () => {
    const bad = createBookingSchema.safeParse({ projectId: "x", leadId: ID, unitId: ID, ratePerSqft: "0", tokenAmount: "-1" });
    expect(bad.success ? [] : bad.error.issues.map((i) => i.path[0])).toEqual(expect.arrayContaining(["projectId", "ratePerSqft", "tokenAmount"]));
    expect(createBookingSchema.parse({ projectId: ID, leadId: ID, unitId: ID, ratePerSqft: "25,000", tokenAmount: "500,000.50" })).toMatchObject({
      ratePerSqft: 25_000,
      tokenAmount: 500_000.5,
    });
  });

  it("requires a cancel reason, a known stage, and ignores rate/token in detail edits", () => {
    expect(cancelSchema.safeParse({ reason: " " }).success).toBe(false);
    expect(advanceSchema.safeParse({ toStage: "paid" }).success).toBe(false);
    expect(updateBookingSchema.parse({ ratePerSqft: 1, paymentDocsStatus: "verified" })).toEqual({ paymentDocsStatus: "verified" });
  });
});

describe("FR-081 hold dates", () => {
  it("defaults the hold to HOLD_DAYS (7) after today in the business time zone, across month and year ends", () => {
    expect(HOLD_DAYS).toBe(7);
    expect(HOLD_STAGES).toEqual(["negotiation", "token_pending"]);
    expect(addDays("2026-11-11", 7)).toBe("2026-11-18");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDays("2028-02-25", 7)).toBe("2028-03-03");
    // 20:00 UTC on 11 Nov is already 12 Nov in Karachi (UTC+5).
    expect(defaultHoldUntil(new Date("2026-11-11T20:00:00Z"))).toBe("2026-11-19");
    expect(defaultHoldUntil(new Date("2026-11-11T18:00:00Z"))).toBe("2026-11-18");
  });
});
