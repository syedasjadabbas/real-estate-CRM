import { eq, inArray } from "drizzle-orm";
import { budgetRanges, cities, leadSources, lostReasons, projects } from "@/server/db/schema";
import { PRIORITY_LABELS, type LeadPriority } from "./constants";
import { formatPhone } from "./phone";
import type { Tx } from "./support";

/**
 * Lead history in plain words (owner, 15 Nov 2026): a timeline entry must still make sense years
 * later, after list values are renamed or removed, so entries store the readable before / after
 * values at the time of the change, not only ids.
 */

type LeadFields = {
  name: string;
  phoneCountryCode: string;
  phoneNumber: string;
  email: string | null;
  cityId: string | null;
  cityOther: string | null;
  gender: string | null;
  sourceId: string;
  budgetRangeId: string | null;
  desiredSize: string | null;
  priority: string;
};

async function namesOf(tx: Tx, table: typeof leadSources | typeof budgetRanges | typeof cities | typeof lostReasons, ids: (string | null | undefined)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!wanted.length) return new Map<string, string>();
  const rows = await tx.select({ id: table.id, name: table.name }).from(table).where(inArray(table.id, wanted));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** The lead's details as a person reads them, keyed by field label. */
async function readable(tx: Tx, rows: LeadFields[]) {
  const [sources, budgets, cityNames] = await Promise.all([
    namesOf(tx, leadSources, rows.map((r) => r.sourceId)),
    namesOf(tx, budgetRanges, rows.map((r) => r.budgetRangeId)),
    namesOf(tx, cities, rows.map((r) => r.cityId)),
  ]);
  return rows.map(
    (r): Record<string, string> => ({
      Name: r.name,
      Phone: formatPhone(r.phoneCountryCode, r.phoneNumber),
      Email: r.email ?? "",
      City: r.cityId ? (cityNames.get(r.cityId) ?? "") : (r.cityOther ?? ""),
      Gender: r.gender ? r.gender[0].toUpperCase() + r.gender.slice(1) : "",
      Source: sources.get(r.sourceId) ?? "",
      Budget: r.budgetRangeId ? (budgets.get(r.budgetRangeId) ?? "") : "",
      "Desired size": r.desiredSize ?? "",
      Priority: PRIORITY_LABELS[r.priority as LeadPriority] ?? r.priority,
    }),
  );
}

export type FieldChange = { field: string; from: string; to: string };

/** Each changed detail with its readable old and new value ("—" when empty). */
export async function describeChanges(tx: Tx, before: LeadFields, after: LeadFields, extra?: { phonesBefore: string[]; phonesAfter: string[] }) {
  const [a, b] = await readable(tx, [before, after]);
  const changes: FieldChange[] = Object.keys(a)
    .filter((k) => a[k] !== b[k])
    .map((k) => ({ field: k, from: a[k] || "—", to: b[k] || "—" }));
  if (extra && extra.phonesBefore.join() !== extra.phonesAfter.join()) {
    changes.push({ field: "Other phone numbers", from: extra.phonesBefore.join(", ") || "—", to: extra.phonesAfter.join(", ") || "—" });
  }
  return changes;
}

/** What the lead looked like when it was created: project, source, budget, city, priority. */
export async function creationSummary(tx: Tx, projectId: string, lead: LeadFields) {
  const [[project], [r]] = await Promise.all([tx.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId)).limit(1), readable(tx, [lead])]);
  return { project: project?.name ?? null, source: r.Source || null, budget: r.Budget || null, city: r.City || null, priority: r.Priority, phone: r.Phone };
}

/** A lost reason's name. */
export async function lostReasonName(tx: Tx, id: string | null) {
  if (!id) return null;
  return (await namesOf(tx, lostReasons, [id])).get(id) ?? null;
}
