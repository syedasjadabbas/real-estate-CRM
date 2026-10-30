export type SearchParams = Record<string, string | string[] | undefined>;

/** Normalises Next's searchParams object to plain strings (first value wins). */
export function flattenParams(params: SearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const v = Array.isArray(value) ? value.join(",") : value;
    if (v !== undefined && v !== "") out[key] = v;
  }
  return out;
}

/** Builds an href from current params with overrides; `null` removes a key. */
export function withParams(pathname: string, current: Record<string, string>, overrides: Record<string, string | null>) {
  const params = new URLSearchParams(current);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export const FILTER_KEYS = ["q", "stage", "source", "city", "lostReason", "priority", "followUp", "from", "to", "dateField"] as const;

export function activeFilterCount(params: Record<string, string>) {
  return FILTER_KEYS.filter((k) => k !== "q" && k !== "dateField" && params[k]).length;
}
