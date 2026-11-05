/**
 * Safe for client components. Keep Zod out of this file: building a schema in the browser
 * probes `new Function`, which the Content Security Policy blocks and reports.
 */

/** The form and API value for "Other": a fixed choice, not a list row, so it can't be renamed or deactivated. */
export const OTHER_CITY = "other";
export const CITY_NAME_MAX = 60;

/** Select options: active cities, the record's own city if it has since been deactivated, then "Other". */
export function cityOptions(cities: { id: string; name: string }[], current?: { id: string; name: string | null } | null) {
  const options = cities.map((c) => ({ value: c.id, label: c.name }));
  if (current && !cities.some((c) => c.id === current.id)) {
    options.push({ value: current.id, label: `${current.name ?? "Unknown"} (inactive)` });
  }
  options.push({ value: OTHER_CITY, label: "Other" });
  return options;
}
