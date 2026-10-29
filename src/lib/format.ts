const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("en");
const dateFmt = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "Asia/Karachi",
});
const timeFmt = new Intl.DateTimeFormat("en", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Karachi",
});

/** Em dash used wherever a value is not available yet. */
export const NO_VALUE = "—";

export const formatCompact = (n: number | null | undefined) => (n == null ? NO_VALUE : compact.format(n));
export const formatInt = (n: number | null | undefined) => (n == null ? NO_VALUE : integer.format(n));
export const formatPct = (n: number | null | undefined) =>
  n == null ? NO_VALUE : `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
export const formatDate = (iso: string) => dateFmt.format(new Date(iso));
export const formatTime = (iso: string) => timeFmt.format(new Date(iso));

export function percentOf(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}
