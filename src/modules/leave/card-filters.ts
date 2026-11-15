import { LEAVE_TYPES } from "./rules";

/**
 * Filters for the cards on HR → Leave (owner, 15 Nov 2026). Each card has its own URL parameters so
 * filtering one card never changes another: dq / dtype (waiting for your decision), cq / ctype
 * (cancellation requests), bq / brole / bshow (balances). Pure, shared by the page and the CSV.
 */
export const BALANCE_SHOWS = { taken: "Took leave", pending: "Has pending days", low: "5 days or fewer left", nologin: "No CRM login" } as const;
export type BalanceShow = keyof typeof BALANCE_SHOWS;

const text = (v: string | undefined) => (v ?? "").trim().toLowerCase().slice(0, 100);
const typeOf = (v: string | undefined) => ((LEAVE_TYPES as readonly string[]).includes(v ?? "") ? v : "");

/** Requests waiting for a decision or a cancellation: by name or reason, and leave type. */
export function filterRequests<T extends { userName: string; reason: string | null; type: string }>(rows: T[], q: string | undefined, type: string | undefined) {
  const term = text(q);
  const t = typeOf(type);
  return rows.filter((r) => (!term || r.userName.toLowerCase().includes(term) || (r.reason ?? "").toLowerCase().includes(term)) && (!t || r.type === t));
}

/** Balances: by name, role, and who to show. */
export function filterBalances<T extends { name: string; role: string | null; granted: number; pending: number; remaining: number; noLogin: boolean }>(
  rows: T[],
  params: { bq?: string; brole?: string; bshow?: string },
) {
  const term = text(params.bq);
  const role = params.brole ?? "";
  const show = (params.bshow ?? "") in BALANCE_SHOWS ? (params.bshow as BalanceShow) : null;
  return rows.filter(
    (r) =>
      (!term || r.name.toLowerCase().includes(term)) &&
      (!role || (role === "none" ? r.role === null : r.role === role)) &&
      (!show ||
        (show === "taken" && r.granted > 0) ||
        (show === "pending" && r.pending > 0) ||
        (show === "low" && r.remaining <= 5) ||
        (show === "nologin" && r.noLogin)),
  );
}
