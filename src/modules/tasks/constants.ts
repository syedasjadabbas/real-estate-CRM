/** FR-090 task types and statuses, in the reference's order and wording. */
export const TASK_TYPES = ["general", "payment_plan", "proposal"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  general: "General",
  payment_plan: "Payment plan printable",
  proposal: "Proposal",
};

export const TASK_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

/** Statuses that still count towards "overdue" (FR-092). */
export const ACTIVE_TASK_STATUSES: TaskStatus[] = ["open", "in_progress"];

/** Types that carry the proposal / payment-plan builder (FR-091). */
export const PLAN_TYPES: TaskType[] = ["payment_plan", "proposal"];
export const hasPlan = (type: TaskType) => PLAN_TYPES.includes(type);

export const TASK_SORT_COLUMNS = ["title", "type", "status", "dueAt", "assignee", "updatedAt"] as const;
export type TaskSortColumn = (typeof TASK_SORT_COLUMNS)[number];

export const TASK_PAGE_SIZE = 50;

/** Upper bound on installment rows a plan can hold (keeps prints and payloads bounded). */
export const MAX_INSTALLMENTS = 360;

/**
 * FR-009 proposal settings keys. The migration seeds the three defaults below (observed / documented,
 * approved 29 Oct 2026, final values pending Q-B6); the code falls back to the same values only if a
 * row is missing. Manager cap, default price and ROI have no documented value and stay unset.
 */
export const PROPOSAL_SETTING_KEYS = {
  agentCap: "proposal.agent_discount_cap_pct",
  managerCap: "proposal.manager_discount_cap_pct",
  downPaymentPct: "proposal.down_payment_pct",
  installmentCount: "proposal.installment_count",
  defaultPricePerSqft: "proposal.default_price_per_sqft",
  roiPerSqft: "proposal.roi_per_sqft",
} as const;
export type ProposalSettingKey = keyof typeof PROPOSAL_SETTING_KEYS;

/** Used when a setting is missing. Down payment 25% per questionnaire Q42 (was 30%). */
export const PROPOSAL_FALLBACKS = { agentCap: 5, downPaymentPct: 25, installmentCount: 36 } as const;

export const DEFAULT_RECURRING_LABEL = "Monthly";
