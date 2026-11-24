import { describe, expect, it } from "vitest";
import { followUpStatus } from "@/features/leads/format";

describe("followUpStatus (client, 24 Nov 2026)", () => {
  // 4 PM on 24 Nov in Pakistan.
  const now = Date.parse("2026-11-24T16:00:00+05:00");
  it("is Overdue once its time has passed, even earlier the same day", () => {
    expect(followUpStatus("2026-11-16T10:00:00+05:00", now)).toBe("Overdue");
    expect(followUpStatus("2026-11-24T15:59:00+05:00", now)).toBe("Overdue");
  });
  it("is Due today until midnight in Pakistan, then Upcoming", () => {
    expect(followUpStatus("2026-11-24T16:00:00+05:00", now)).toBe("Due today");
    expect(followUpStatus("2026-11-24T23:59:00+05:00", now)).toBe("Due today");
    expect(followUpStatus("2026-11-25T00:00:00+05:00", now)).toBe("Upcoming");
    // Still the 24th in UTC, already the 25th in Pakistan.
    expect(followUpStatus("2026-11-24T19:30:00Z", now)).toBe("Upcoming");
  });
});
