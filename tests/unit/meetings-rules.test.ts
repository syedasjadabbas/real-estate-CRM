import { describe, expect, it } from "vitest";
import { LEAD_STAGES } from "@/modules/leads/constants";
import { wouldMoveLead } from "@/modules/meetings/constants";
import { canAccessMeeting, canDoMeeting, canPickOrganizer, meetingScope } from "@/modules/meetings/policy";
import { completeSchema, createMeetingSchema, meetingListQuerySchema, updateMeetingSchema } from "@/modules/meetings/validation";
import type { Role } from "@/server/auth/types";

const roles: Role[] = ["super_admin", "admin", "manager", "agent", "hr", "accountant"];
const me = "6f1c2a64-0a52-4b9b-9a0e-6f0d2b1c9e11";
const mate = "7a1c2a64-0a52-4b9b-9a0e-6f0d2b1c9e12";
const other = "8b1c2a64-0a52-4b9b-9a0e-6f0d2b1c9e13";
const LEAD = "9c1c2a64-0a52-4b9b-9a0e-6f0d2b1c9e14";

describe("meetings policy (Meetings F/F/T/O/—/—)", () => {
  it("maps roles to actions and scopes", () => {
    expect(roles.filter((role) => canDoMeeting({ role }, "view"))).toEqual(["super_admin", "admin", "manager", "agent"]);
    expect(roles.filter((role) => canDoMeeting({ role }, "create"))).toEqual(["super_admin", "admin", "manager", "agent"]);
    expect(roles.map(meetingScope)).toEqual(["all", "all", "team", "own", "none", "none"]);
  });

  it("scopes by organizer or creator, and limits organizer choice", () => {
    const m = { organizerId: mate, createdById: other };
    expect(canAccessMeeting({ id: me, role: "agent" }, m)).toBe(false);
    expect(canAccessMeeting({ id: mate, role: "agent" }, m)).toBe(true);
    expect(canAccessMeeting({ id: other, role: "agent" }, m)).toBe(true);
    expect(canAccessMeeting({ id: me, role: "manager" }, m, [mate])).toBe(true);
    expect(canAccessMeeting({ id: me, role: "accountant" }, m)).toBe(false);
    expect(canPickOrganizer({ id: me, role: "agent" }, mate)).toBe(false);
    expect(canPickOrganizer({ id: me, role: "manager" }, mate, [mate])).toBe(true);
    expect(canPickOrganizer({ id: me, role: "admin" }, other)).toBe(true);
  });
});

describe("forward-only lead moves (D1 / D2)", () => {
  it("moves to Meeting Scheduled only from the early stages", () => {
    expect(LEAD_STAGES.filter((s) => wouldMoveLead("schedule", s))).toEqual(["new_lead", "contact_attempted", "contacted", "qualified_lead"]);
  });
  it("moves to Meeting Done only from the early stages or Meeting Scheduled", () => {
    expect(LEAD_STAGES.filter((s) => wouldMoveLead("complete", s))).toEqual(["new_lead", "contact_attempted", "contacted", "qualified_lead", "meeting_scheduled"]);
    for (const s of ["meeting_done", "booking_in_process", "booked", "lost_lead", "future_opportunity"] as const) expect(wouldMoveLead("complete", s)).toBe(false);
  });
});

describe("meetings validation", () => {
  const base = { title: "Site visit", startsAt: "2026-11-02T10:00:00+05:00", leadId: LEAD };
  it("requires title, start and lead; defaults moveLead to true", () => {
    expect(createMeetingSchema.safeParse({ ...base, title: " " }).success).toBe(false);
    expect(createMeetingSchema.safeParse({ ...base, startsAt: "" }).success).toBe(false);
    expect(createMeetingSchema.safeParse({ ...base, leadId: "" }).success).toBe(false);
    expect(createMeetingSchema.safeParse({ ...base, startsAt: "not a date" }).success).toBe(false);
    const ok = createMeetingSchema.parse({ ...base, location: " ", endsAt: "" });
    expect(ok).toMatchObject({ moveLead: true, location: null, endsAt: null });
  });
  it("rejects an end before or equal to the start", () => {
    const r = createMeetingSchema.safeParse({ ...base, endsAt: "2026-11-02T09:00:00+05:00" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["endsAt"]);
    expect(updateMeetingSchema.safeParse({ startsAt: "2026-11-02T10:00:00Z", endsAt: "2026-11-02T10:00:00Z" }).success).toBe(false);
  });
  it("completion note is optional; list query falls back to safe defaults", () => {
    expect(completeSchema.parse({})).toEqual({ note: null, moveLead: true });
    expect(meetingListQuerySchema.parse({ sort: "x", dir: "y", page: "0", status: "done" })).toMatchObject({ sort: "startsAt", dir: "desc", page: 1, status: undefined });
  });
});
