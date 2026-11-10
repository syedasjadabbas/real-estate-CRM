import { describe, expect, it } from "vitest";
import {
  agentScore,
  availabilityScore,
  conversionScore,
  DEFAULT_ASSIGNMENT_SETTINGS as S,
  inWorkingHours,
  NEUTRAL,
  performanceScore,
  pickCandidate,
  weightedScore,
  workloadScore,
  type AgentStats,
} from "@/modules/leads/assignment-score";

const stats = (over: Partial<AgentStats> = {}): AgentStats => ({
  openLeads: 0, pendingFollowUps: 0, followUpsDue: 0, followUpsDone: 0, leadsToTouch: 0, touchedWithinDay: 0, booked: 0, lost: 0, online: false, ...over,
});

describe("assignment scoring", () => {
  it("starts a new agent at neutral, not at 0 or 100", () => {
    expect(conversionScore(0, 0, S.minDecidedLeads)).toBe(NEUTRAL);
    expect(performanceScore(stats(), S.minPerformanceSample)).toBe(NEUTRAL);
    const fresh = agentScore(stats(), S);
    expect(fresh.score).toBe(50);
    expect(fresh.provisional).toBe(true);
  });

  it("doesn't let one lucky booking make a perfect conversion score", () => {
    expect(conversionScore(1, 0, 10)).toBeLessThan(0.6);
    expect(conversionScore(0, 1, 10)).toBeGreaterThan(0.4);
    // With a real sample, the agent's own rate dominates.
    expect(conversionScore(80, 20, 10)).toBeGreaterThan(0.75);
  });

  it("scores workload from empty to full", () => {
    expect(workloadScore(0, 80)).toBe(1);
    expect(workloadScore(40, 80)).toBe(0.5);
    expect(workloadScore(100, 80)).toBe(0);
  });

  it("scores availability from sign-in status and working hours", () => {
    expect(availabilityScore(true, true, 0.3)).toBe(1);
    expect(availabilityScore(false, true, 0.3)).toBe(0.3);
    expect(availabilityScore(true, false, 0.3)).toBe(0.5);
  });

  it("weights the four parts 40 / 30 / 20 / 10 by default", () => {
    expect(weightedScore({ workload: 1, performance: 0, conversion: 0, availability: 0 }, S)).toBe(0.4);
    expect(weightedScore({ workload: 0, performance: 0, conversion: 1, availability: 0 }, S)).toBe(0.2);
    expect(weightedScore({ workload: 1, performance: 1, conversion: 1, availability: 1 }, S)).toBe(1);
  });

  it("does not hand every lead to the best performer: a busy star loses to an idle average agent", () => {
    const star = weightedScore({ workload: workloadScore(70, 80), performance: 0.95, conversion: 0.9, availability: 1 }, S);
    const average = weightedScore({ workload: workloadScore(5, 80), performance: 0.5, conversion: 0.5, availability: 1 }, S);
    expect(average).toBeGreaterThan(star);
  });

  it("breaks ties by lighter load, then longest wait, then id", () => {
    const c = (userId: string, load: number, last: number | null) => ({ userId, name: userId, load, lastAssignedAt: last, score: 0.7, components: { workload: 0, performance: 0, conversion: 0, availability: 0 } });
    expect(pickCandidate([c("b", 5, null), c("a", 3, null)])?.userId).toBe("a");
    expect(pickCandidate([c("a", 3, 2000), c("b", 3, 1000)])?.userId).toBe("b");
    expect(pickCandidate([c("b", 3, null), c("a", 3, null)])?.userId).toBe("a");
    expect(pickCandidate([])).toBeNull();
  });

  it("reads working hours in Pakistan time, including windows past midnight", () => {
    expect(inWorkingHours(new Date("2026-11-10T05:00:00Z"), "09:00", "19:00")).toBe(true); // 10:00 PKT
    expect(inWorkingHours(new Date("2026-11-10T15:00:00Z"), "09:00", "19:00")).toBe(false); // 20:00 PKT
    expect(inWorkingHours(new Date("2026-11-10T18:00:00Z"), "22:00", "06:00")).toBe(true); // 23:00 PKT
  });
});
