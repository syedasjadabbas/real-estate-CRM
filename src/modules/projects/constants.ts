/** Project types and statuses from FR-060 / DATA_MODEL.md §3 (reference shows the BUILDING badge). */
export const PROJECT_TYPES = ["building", "farmhouse", "society"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  building: "Building",
  farmhouse: "Farmhouse",
  society: "Society",
};

export const PROJECT_STATUSES = ["active", "inactive"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "Active",
  inactive: "Inactive",
};

/** Cards per page (the reference had 4 projects, so its page size was never visible). */
export const PROJECT_PAGE_SIZE = 24;
