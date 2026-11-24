/**
 * People have a first and a last name (client, 23 Nov 2026). The full `name` stays the one every list,
 * search and print uses; a database trigger (migration 0059) keeps first_name / last_name in step with it.
 */

/** A title stays with the first name: "Mr Arslan Malik" → "Mr Arslan" + "Malik". Same rule as person_first_name() in SQL. */
const FIRST = /^((?:mr|mrs|ms|miss|dr|engr|eng|prof|col|maj|gen|capt|brig)\.?\s+\S+|\S+)/i;

const clean = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");

export const joinName = (first: unknown, last: unknown) => [clean(first), clean(last)].filter(Boolean).join(" ");

export function splitName(name: string | null | undefined) {
  const full = clean(name);
  const firstName = full.match(FIRST)?.[1] ?? "";
  return { firstName, lastName: full.slice(firstName.length).trim() };
}

export type NameParts = { firstName: string; lastName: string | null };

/**
 * Takes first / last name out of a form's input and puts the full name under `key`, so every schema keeps
 * validating one name. Input that already has a full name (API callers, older files) passes unchanged.
 * A blank first name gives a blank full name, which the schema refuses.
 */
export function nameFromParts(input: unknown, key = "name"): { input: unknown; parts: NameParts | null } {
  if (!input || typeof input !== "object" || !("firstName" in input)) return { input, parts: null };
  const { firstName, lastName, ...rest } = input as Record<string, unknown>;
  const first = clean(firstName);
  if (!first) return { input: { ...rest, [key]: "" }, parts: null };
  return { input: { ...rest, [key]: joinName(first, lastName) }, parts: { firstName: first, lastName: clean(lastName) || null } };
}

/** Saved parts for an edit form, falling back to splitting the full name. */
export const namePartsOf = (row: { name: string | null; firstName?: string | null; lastName?: string | null }) =>
  row.firstName ? { firstName: row.firstName, lastName: row.lastName ?? "" } : splitName(row.name);
