const amount = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** "674 sq ft" (up to 2 decimals). */
export function formatArea(n: number | null | undefined) {
  return n == null ? "—" : `${amount.format(n)} sq ft`;
}

/** "PKR 12,500,000" — base prices are entered in PKR (ASSUMED currency; the reference showed plain numbers). */
export function formatPrice(n: number | null | undefined) {
  return n == null ? "—" : `PKR ${amount.format(n)}`;
}

/** "Oct 29, 2026" for a YYYY-MM-DD date column. */
export function formatListedOn(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

/** A booked unit's booking date, in the business time zone (e.g. "Oct 29, 2026"). */
export function formatBookedOn(value: string | Date) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Karachi" });
}
