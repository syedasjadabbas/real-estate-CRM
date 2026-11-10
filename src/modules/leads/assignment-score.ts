/**
 * Pure scoring for automatic lead assignment and agent scores. No database access, so it can be
 * tested directly and reused by the assignment engine, My Teams and the dashboard.
 */

export type AssignmentSettings = {
  weightWorkload: number;
  weightPerformance: number;
  weightConversion: number;
  weightAvailability: number;
  /** Open leads plus pending follow-ups at which an agent is full and gets no more leads. */
  maxLoad: number;
  /** Decided leads (booked + lost) before an agent's own conversion rate counts in full. */
  minDecidedLeads: number;
  /** Follow-ups due plus leads to touch before an agent's own performance counts in full. */
  minPerformanceSample: number;
  lookbackDays: number;
  /** An agent counts as signed in if their session was used this recently. */
  onlineMinutes: number;
  /** Availability of an agent who is on duty but not signed in, from 0 to 1. */
  offlineAvailability: number;
  /** Working hours in Pakistan time, "HH:MM". Outside them availability is halved. */
  workStart: string;
  workEnd: string;
};

/** Initial weights confirmed with the client; everything else is a starting value they can change. */
export const DEFAULT_ASSIGNMENT_SETTINGS: AssignmentSettings = {
  weightWorkload: 40,
  weightPerformance: 30,
  weightConversion: 20,
  weightAvailability: 10,
  maxLoad: 80,
  minDecidedLeads: 10,
  minPerformanceSample: 10,
  lookbackDays: 90,
  onlineMinutes: 30,
  offlineAvailability: 0.3,
  workStart: "09:00",
  workEnd: "19:00",
};

/** Raw counts for one agent. */
export type AgentStats = {
  openLeads: number;
  pendingFollowUps: number;
  followUpsDue: number;
  followUpsDone: number;
  leadsToTouch: number;
  touchedWithinDay: number;
  booked: number;
  lost: number;
  online: boolean;
};

export const NEUTRAL = 0.5;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Conversion quality, 0–1. Shrunk towards neutral until the agent has `minDecided` decided leads,
 * so one lucky booking can't make a new agent look perfect, and one loss can't sink them.
 */
export function conversionScore(booked: number, lost: number, minDecided: number) {
  const decided = booked + lost;
  const k = Math.max(1, minDecided);
  return round((booked + NEUTRAL * k) / (decided + k));
}

/**
 * Performance, 0–1: follow-up completion and first touch within a day, averaged. Shrunk towards
 * neutral in the same way until there is enough activity to judge.
 */
export function performanceScore(s: Pick<AgentStats, "followUpsDue" | "followUpsDone" | "leadsToTouch" | "touchedWithinDay">, minSample: number) {
  const parts: number[] = [];
  if (s.followUpsDue > 0) parts.push(s.followUpsDone / s.followUpsDue);
  if (s.leadsToTouch > 0) parts.push(s.touchedWithinDay / s.leadsToTouch);
  const sample = s.followUpsDue + s.leadsToTouch;
  if (parts.length === 0) return NEUTRAL;
  const raw = parts.reduce((a, b) => a + b, 0) / parts.length;
  const k = Math.max(1, minSample);
  return round((raw * sample + NEUTRAL * k) / (sample + k));
}

/** 1 when empty, 0 when full. */
export function workloadScore(load: number, maxLoad: number) {
  return round(clamp(1 - load / Math.max(1, maxLoad)));
}

export function availabilityScore(online: boolean, inWorkingHours: boolean, offline: number) {
  return round(clamp((online ? 1 : offline) * (inWorkingHours ? 1 : 0.5)));
}

export type Components = { workload: number; performance: number; conversion: number; availability: number };

export function weightedScore(c: Components, s: AssignmentSettings) {
  const weights = [s.weightWorkload, s.weightPerformance, s.weightConversion, s.weightAvailability];
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const sum = c.workload * s.weightWorkload + c.performance * s.weightPerformance + c.conversion * s.weightConversion + c.availability * s.weightAvailability;
  return round(sum / total);
}

/** Is "HH:MM" Pakistan time inside [start, end)? Handles windows that cross midnight. */
export function inWorkingHours(now: Date, start: string, end: string) {
  const local = new Date(now.getTime() + 5 * 3_600_000);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const a = toMin(start);
  const b = toMin(end);
  return a <= b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}

export type Candidate = {
  userId: string;
  name: string;
  load: number;
  lastAssignedAt: number | null;
  components: Components;
  score: number;
};

/**
 * The best candidate: highest score; ties go to the lighter load, then whoever waited longest
 * since their last assignment, then a stable id order.
 */
export function pickCandidate(candidates: Candidate[]) {
  return (
    [...candidates].sort(
      (a, b) =>
        b.score - a.score ||
        a.load - b.load ||
        (a.lastAssignedAt ?? 0) - (b.lastAssignedAt ?? 0) ||
        a.userId.localeCompare(b.userId),
    )[0] ?? null
  );
}

/** Agent score for My Teams and the dashboard, 0–100: performance and conversion only. */
export function agentScore(stats: AgentStats, s: AssignmentSettings) {
  const performance = performanceScore(stats, s.minPerformanceSample);
  const conversion = conversionScore(stats.booked, stats.lost, s.minDecidedLeads);
  const weights = s.weightPerformance + s.weightConversion || 1;
  const value = (performance * s.weightPerformance + conversion * s.weightConversion) / weights;
  const decided = stats.booked + stats.lost;
  const sample = stats.followUpsDue + stats.leadsToTouch;
  return {
    score: Math.round(value * 100),
    performance: Math.round(performance * 100),
    conversion: Math.round(conversion * 100),
    /** Not enough history yet: the score leans on the neutral starting value. */
    provisional: decided < s.minDecidedLeads || sample < s.minPerformanceSample,
  };
}
