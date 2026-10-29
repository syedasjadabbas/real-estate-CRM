/** Relationship values come from the draft data model; the reference never showed them (pending confirmation). */
export const RELATIONSHIPS = ["prospect", "investor", "repeat_investor"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  prospect: "Prospect",
  investor: "Investor",
  repeat_investor: "Repeat investor",
};

export const CLIENT_SORT_COLUMNS = ["updatedAt", "name", "nextFollowUpAt", "relationship"] as const;
export type ClientSortColumn = (typeof CLIENT_SORT_COLUMNS)[number];

/** Same page size as the Leads tables. */
export const CLIENT_PAGE_SIZE = 50;
