/**
 * Fixed-window login limiter: 5 failures per 15 minutes per key (email + IP).
 * In-memory, which is correct for the single-server deployment in SYSTEM_ARCHITECTURE.md;
 * move to the database if the app ever runs on more than one instance.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

const failures = new Map<string, { count: number; resetAt: number }>();

export function isLimited(key: string, now = Date.now()) {
  const entry = failures.get(key);
  if (!entry || entry.resetAt <= now) return false;
  return entry.count >= MAX_FAILURES;
}

export function recordFailure(key: string, now = Date.now()) {
  const entry = failures.get(key);
  if (!entry || entry.resetAt <= now) {
    failures.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export function clearFailures(key: string) {
  failures.delete(key);
}
