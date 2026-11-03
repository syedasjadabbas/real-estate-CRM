/** Income (FR-200) and expense (FR-201) entry kinds; safe to import in client components. */
export const ENTRY_KINDS = ["income", "expense"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const ENTRY_KIND_LABELS: Record<EntryKind, string> = { income: "Income", expense: "Expense" };
