import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/*
 * Database schema for the Auth, Leads and Clients milestones.
 * Mirrors docs/DATA_MODEL.md §2, §4 and §8. All timestamps are timestamptz (UTC).
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// ─── Enums ────────────────────────────────────────────────────────────────────

export const userRole = pgEnum("user_role", ["super_admin", "admin", "manager", "agent", "hr", "accountant"]);
export const userStatus = pgEnum("user_status", ["active", "inactive"]);
export const signinEvent = pgEnum("signin_event", ["sign_in", "sign_out"]);
export const projectType = pgEnum("project_type", ["building", "farmhouse", "society"]);
export const projectStatus = pgEnum("project_status", ["active", "inactive"]);

export const leadStage = pgEnum("lead_stage", [
  "new_lead",
  "contact_attempted",
  "contacted",
  "qualified_lead",
  "meeting_scheduled",
  "meeting_done",
  "booking_in_process",
  "booked",
  "lost_lead",
  "future_opportunity",
]);
export const inboundChannel = pgEnum("inbound_channel", ["manual", "meta", "tiktok", "import"]);
export const leadPriority = pgEnum("lead_priority", ["none", "low", "medium", "high"]);
export const leadActivityType = pgEnum("lead_activity_type", [
  "created",
  "note",
  "stage_change",
  "follow_up_scheduled",
  "follow_up_done",
  "assignment",
  "update",
  "review",
  "regenerated",
  "lost_requested",
  "lost_decided",
  "meeting",
  "file_uploaded",
  "file_deleted",
  "client_linked",
]);
/** DATA_MODEL.md "files". Only call recordings on leads are uploaded so far (FR-038). */
export const fileKind = pgEnum("file_kind", ["call_recording", "document", "receipt", "other"]);
export const followUpStatus = pgEnum("follow_up_status", ["pending", "done", "cancelled"]);
export const approvalType = pgEnum("approval_type", ["lead_lost"]);
export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "rejected"]);
// Values from the draft data model; the reference never showed them (pending client confirmation).
export const clientRelationship = pgEnum("client_relationship", ["prospect", "investor", "repeat_investor"]);
export const unitSaleModel = pgEnum("unit_sale_model", ["whole", "spu", "fractional_50"]);
export const unitStatus = pgEnum("unit_status", ["available", "partially_booked", "reserved", "booked", "sold"]);
export const bookingStage = pgEnum("booking_stage", [
  "negotiation",
  "token_pending",
  "token_received",
  "provisional_receipt",
  "sales_order",
  "booking_form",
  "down_payment",
  "agreement_pending",
  "confirmed",
  "cancelled",
]);
export const paymentDocsStatus = pgEnum("payment_docs_status", ["not_submitted", "submitted", "verified"]);
export const bookingPaymentKind = pgEnum("booking_payment_kind", ["payment", "reversal"]);
export const bookingPaymentType = pgEnum("booking_payment_type", ["token", "down_payment", "installment", "other"]);
export const reversalRequestStatus = pgEnum("reversal_request_status", ["pending", "approved", "rejected"]);
export const targetPeriod = pgEnum("target_period", ["daily", "weekly", "monthly"]);
export const rosterStatus = pgEnum("roster_status", ["in_office", "on_site", "on_leave", "leads_off"]);
export const holidayScope = pgEnum("holiday_scope", ["company", "regional"]);
/** Q10, Q11: "CPL" means medical leave and is taken from the annual allowance. */
export const leaveType = pgEnum("leave_type", ["annual", "medical"]);
export const leaveStatus = pgEnum("leave_status", ["pending", "approved", "rejected", "withdrawn", "cancel_requested", "cancelled"]);
export const meetingStatus = pgEnum("meeting_status", ["scheduled", "completed", "cancelled"]);
/** Meeting type (client request, 11 Nov 2026). Null only on meetings created before the field existed. */
export const meetingType = pgEnum("meeting_type", ["company_office", "site_visit", "virtual", "outdoor", "sales_event"]);
export const taskType = pgEnum("task_type", ["general", "payment_plan", "proposal"]);
export const taskStatus = pgEnum("task_status", ["open", "in_progress", "done", "cancelled"]);
export const clientActivityType = pgEnum("client_activity_type", [
  "created",
  "note",
  "update",
  "follow_up_scheduled",
  "follow_up_done",
  "lead_linked",
  "assignment",
  "file_uploaded",
]);

// ─── Identity ─────────────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRole("role").notNull(),
    status: userStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("sessions_token_hash_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const signinLogs = pgTable(
  "signin_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    event: signinEvent("event").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("signin_logs_user_at_idx").on(t.userId, t.at)],
);

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  managerId: uuid("manager_id").references(() => users.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true),
  /** Holiday region of the team's members (questionnaire Q5); matches `holidays.region` ignoring case. */
  region: text("region"),
  /** Weekend days for the duty roster (questionnaire Q9), 0 = Sunday … 6 = Saturday. Empty = none set. */
  weekendDays: integer("weekend_days").array().notNull().default(sql`'{}'::integer[]`),
  ...timestamps,
});

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] }), index("team_members_user_idx").on(t.userId)],
);

// ─── Projects & lookups ───────────────────────────────────────────────────────

export type ProjectDimensions = Partial<Record<"floors" | "blocks" | "categories" | "types" | "premiums", string[]>>;

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    type: projectType("type").notNull().default("building"),
    developer: text("developer"),
    city: text("city"),
    address: text("address"),
    description: text("description"),
    /** FR-061 per-project unit dimensions: allowed floors, blocks, categories, types, premiums. */
    dimensionConfig: jsonb("dimension_config").$type<ProjectDimensions>().notNull().default({}),
    status: projectStatus("status").notNull().default("active"),
    ...timestamps,
  },
  // Names are unique ignoring case ("Serene Heights" = "serene heights").
  (t) => [uniqueIndex("projects_name_lower_uq").on(sql`lower(${t.name})`)],
);

// A fresh column set per table: shared builder objects make drizzle name every
// table's unique constraint after the first table.
const lookupColumns = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const leadSources = pgTable("lead_sources", lookupColumns());
/** Configurable payment methods (proposed defaults seeded by migration 0005; client to confirm, Q-F7). */
export const paymentMethods = pgTable("payment_methods", lookupColumns());
export const cities = pgTable("cities", lookupColumns(), (t) => [uniqueIndex("cities_name_lower_uq").on(sql`lower(${t.name})`)]);
export const lostReasons = pgTable("lost_reasons", lookupColumns());
export const budgetRanges = pgTable("budget_ranges", lookupColumns());

// ─── Leads ────────────────────────────────────────────────────────────────────

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    phoneCountryCode: text("phone_country_code").notNull(),
    phoneNumber: text("phone_number").notNull(),
    phoneE164: text("phone_e164").notNull(),
    email: text("email"),
    cityId: uuid("city_id").references(() => cities.id, { onDelete: "restrict" }),
    /** A city typed under "Other" (FR-042); city_id is then null. */
    cityOther: text("city_other"),
    gender: text("gender"),
    stage: leadStage("stage").notNull().default("new_lead"),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => leadSources.id, { onDelete: "restrict" }),
    inboundChannel: inboundChannel("inbound_channel").notNull().default("manual"),
    /** The ad platform's lead id (MODULES 2.2). Blank until an integration or import supplies it. */
    externalId: text("external_id"),
    budgetRangeId: uuid("budget_range_id").references(() => budgetRanges.id, { onDelete: "restrict" }),
    desiredSize: text("desired_size"),
    priority: leadPriority("priority").notNull().default("none"),
    nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
    firstTouchAt: timestamp("first_touch_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    isRegenerated: boolean("is_regenerated").notNull().default(false),
    regeneratedAt: timestamp("regenerated_at", { withTimezone: true }),
    duplicateOfId: uuid("duplicate_of_id").references((): AnyPgColumn => leads.id, { onDelete: "restrict" }),
    clientId: uuid("client_id").references((): AnyPgColumn => clients.id, { onDelete: "set null" }),
    lostReasonId: uuid("lost_reason_id").references(() => lostReasons.id, { onDelete: "restrict" }),
    latestComment: text("latest_comment"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("leads_code_uq").on(t.code),
    index("leads_project_stage_idx").on(t.projectId, t.stage),
    index("leads_owner_stage_idx").on(t.ownerId, t.stage),
    index("leads_project_created_idx").on(t.projectId, t.createdAt),
    index("leads_project_phone_idx").on(t.projectId, t.phoneE164),
    index("leads_next_follow_up_idx").on(t.nextFollowUpAt),
    index("leads_client_idx").on(t.clientId),
    check("leads_code_format", sql`${t.code} ~ '^[A-Z]{8}$'`),
    check("leads_phone_e164_format", sql`${t.phoneE164} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check("leads_not_self_duplicate", sql`${t.duplicateOfId} is null or ${t.duplicateOfId} <> ${t.id}`),
  ],
);

export const leadActivities = pgTable(
  "lead_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    type: leadActivityType("type").notNull(),
    body: text("body"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lead_activities_lead_created_idx").on(t.leadId, t.createdAt)],
);

/**
 * Uploaded files (DATA_MODEL.md "files"). The bytes live in private storage under `storage_key`
 * (src/server/storage); only metadata is here. Lead files only for now, so the owner is an explicit
 * `lead_id` foreign key rather than a polymorphic owner column. No delete path exists yet.
 */
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The lead (recordings, documents, payment proofs). Null for income / expense attachments and client documents. */
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "restrict" }),
    /** For income / expense attachments (kind "receipt", FR-200 / FR-201): the entry the file belongs to. */
    financeEntryId: uuid("finance_entry_id").references((): AnyPgColumn => financeEntries.id, { onDelete: "restrict" }),
    /** For payment proofs (kind "receipt", questionnaire Q33): the payment the file belongs to. */
    paymentId: uuid("payment_id").references((): AnyPgColumn => bookingPayments.id, { onDelete: "restrict" }),
    /** For contracts and other documents kept on the client itself (kind "document", FR-052). */
    clientId: uuid("client_id").references((): AnyPgColumn => clients.id, { onDelete: "restrict" }),
    kind: fileKind("kind").notNull(),
    storageKey: text("storage_key").notNull(),
    originalName: text("original_name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** Reported by the uploader's browser from the audio metadata; null when it could not be read. */
    durationSec: integer("duration_sec"),
    sha256: text("sha256").notNull(),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    /** Hidden by a Super Admin (Q53). The row and the stored file are kept; nothing is erased. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedById: uuid("deleted_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("files_storage_key_uq").on(t.storageKey),
    index("files_lead_created_idx").on(t.leadId, t.createdAt),
    index("files_client_created_idx").on(t.clientId, t.createdAt),
    check("files_size_positive", sql`${t.sizeBytes} > 0`),
    check("files_owner", sql`${t.leadId} is not null or ${t.financeEntryId} is not null or ${t.clientId} is not null`),
    check("files_duration_range", sql`${t.durationSec} is null or (${t.durationSec} >= 0 and ${t.durationSec} <= 86400)`),
    check("files_name_length", sql`char_length(${t.originalName}) between 1 and 200`),
  ],
);

export const followUps = pgTable(
  "follow_ups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    assigneeId: uuid("assignee_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    note: text("note"),
    status: followUpStatus("status").notNull().default("pending"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneById: uuid("done_by_id").references(() => users.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("follow_ups_assignee_status_due_idx").on(t.assigneeId, t.status, t.dueAt),
    index("follow_ups_lead_idx").on(t.leadId),
  ],
);

export const leadFavorites = pgTable(
  "lead_favorites",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.leadId] })],
);

export const leadReviews = pgTable(
  "lead_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lead_reviews_lead_idx").on(t.leadId)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: approvalType("type").notNull(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    requestedById: uuid("requested_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    lostReasonId: uuid("lost_reason_id").references(() => lostReasons.id, { onDelete: "restrict" }),
    note: text("note"),
    status: approvalStatus("status").notNull().default("pending"),
    decidedById: uuid("decided_by_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionComment: text("decision_comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("approvals_one_pending_per_lead_uq")
      .on(t.leadId, t.type)
      .where(sql`${t.status} = 'pending'`),
    index("approvals_status_idx").on(t.status, t.createdAt),
  ],
);

// ─── Inventory ────────────────────────────────────────────────────────────────

/**
 * Units for sale per project (DATA_MODEL.md §3, FR-070). Status changes go through the
 * guarded transition in modules/inventory/status.ts so concurrent bookings cannot both claim a unit.
 * SPU / 50% share rows are not modelled until Q-B1 is answered.
 */
export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    unitNo: text("unit_no").notNull(),
    floor: text("floor"),
    block: text("block"),
    saleModel: unitSaleModel("sale_model").notNull().default("whole"),
    areaSqft: numeric("area_sqft", { precision: 12, scale: 2, mode: "number" }).notNull(),
    basePrice: numeric("base_price", { precision: 15, scale: 2, mode: "number" }).notNull(),
    nature: text("nature"),
    category: text("category"),
    type: text("type"),
    bedrooms: integer("bedrooms"),
    premium: text("premium"),
    status: unitStatus("status").notNull().default("available"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    comment: text("comment"),
    listedOn: date("listed_on"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("units_project_unit_no_uq").on(t.projectId, sql`lower(${t.unitNo})`),
    index("units_project_status_idx").on(t.projectId, t.status),
    index("units_project_floor_idx").on(t.projectId, t.floor),
    check("units_area_positive", sql`${t.areaSqft} > 0`),
    check("units_price_non_negative", sql`${t.basePrice} >= 0`),
    check("units_bedrooms_non_negative", sql`${t.bedrooms} is null or ${t.bedrooms} >= 0`),
    // FR-072: only split units (SPU / 50%) can be partially booked.
    check("units_partial_needs_split", sql`${t.status} <> 'partially_booked' or ${t.saleModel} <> 'whole'`),
  ],
);

// ─── Bookings ─────────────────────────────────────────────────────────────────

/**
 * Bookings (DATA_MODEL.md §5, FR-080–085). Whole units only until Q-B1; no payments until the
 * Finance module (decision 29 Oct 2026). The partial unique index is the database backstop for
 * "one active booking per unit"; the guarded unit transition is the first line of defence.
 */
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "restrict" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "restrict" }),
    agentId: uuid("agent_id").references(() => users.id, { onDelete: "restrict" }),
    ratePerSqft: numeric("rate_per_sqft", { precision: 14, scale: 2, mode: "number" }).notNull(),
    areaSqft: numeric("area_sqft", { precision: 12, scale: 2, mode: "number" }).notNull(),
    totalSale: numeric("total_sale", { precision: 16, scale: 2, mode: "number" }).notNull(),
    tokenAmount: numeric("token_amount", { precision: 15, scale: 2, mode: "number" }).notNull(),
    reservedUntil: date("reserved_until"),
    stage: bookingStage("stage").notNull().default("negotiation"),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    paymentInstructions: text("payment_instructions"),
    agreementSentOn: date("agreement_sent_on"),
    paymentDocsStatus: paymentDocsStatus("payment_docs_status").notNull().default("not_submitted"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledReason: text("cancelled_reason"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("bookings_one_active_per_unit_uq").on(t.unitId).where(sql`${t.stage} <> 'cancelled'`),
    index("bookings_project_stage_idx").on(t.projectId, t.stage),
    index("bookings_agent_idx").on(t.agentId),
    index("bookings_lead_idx").on(t.leadId),
    index("bookings_client_idx").on(t.clientId),
    check("bookings_rate_positive", sql`${t.ratePerSqft} > 0`),
    check("bookings_area_positive", sql`${t.areaSqft} > 0`),
    check("bookings_token_positive", sql`${t.tokenAmount} > 0`),
    check("bookings_token_within_total", sql`${t.tokenAmount} <= ${t.totalSale}`),
    // A booking is cancelled exactly when it has a cancellation time, and a cancellation needs a reason.
    check("bookings_cancelled_fields", sql`(${t.stage} = 'cancelled') = (${t.cancelledAt} is not null)`),
    check("bookings_cancel_reason", sql`${t.stage} <> 'cancelled' or ${t.cancelledReason} is not null`),
  ],
);

export const bookingStageHistory = pgTable(
  "booking_stage_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    fromStage: bookingStage("from_stage"),
    toStage: bookingStage("to_stage").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("booking_stage_history_booking_idx").on(t.bookingId, t.createdAt)],
);

// ─── Accounts & Finance (F1: booking payments) ────────────────────────────────

/** Receipt numbers for posted payments: sequential, never reused; gaps allowed (proposed Q-F3 default). */
export const receiptNoSeq = pgSequence("booking_payment_receipt_no_seq", { startWith: 1, increment: 1 });
/** Separate reference numbers for reversals, which also point at the original receipt. */
export const reversalRefSeq = pgSequence("booking_payment_reversal_ref_seq", { startWith: 1, increment: 1 });

/**
 * Posted booking payments and their reversals (FR-202, FR-204, FR-206). Rows are append-only:
 * a trigger (migration 0005) rejects UPDATE and DELETE, so corrections are reversal rows.
 * Paid = sum(payment) − sum(reversal); nothing is cached.
 */
export const bookingPayments = pgTable(
  "booking_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    kind: bookingPaymentKind("kind").notNull(),
    type: bookingPaymentType("type").notNull(),
    amount: numeric("amount", { precision: 15, scale: 2, mode: "number" }).notNull(),
    receivedOn: date("received_on").notNull(),
    methodId: uuid("method_id").references(() => paymentMethods.id, { onDelete: "restrict" }),
    reference: text("reference"),
    note: text("note"),
    receiptNo: integer("receipt_no"),
    reversalRef: integer("reversal_ref"),
    reversalOfId: uuid("reversal_of_id").references((): AnyPgColumn => bookingPayments.id, { onDelete: "restrict" }),
    reversalRequestId: uuid("reversal_request_id").references((): AnyPgColumn => paymentReversalRequests.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key"),
    recordedById: uuid("recorded_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("booking_payments_receipt_no_uq").on(t.receiptNo),
    uniqueIndex("booking_payments_reversal_ref_uq").on(t.reversalRef),
    uniqueIndex("booking_payments_one_reversal_uq").on(t.reversalOfId),
    uniqueIndex("booking_payments_idempotency_uq").on(t.recordedById, t.idempotencyKey),
    index("booking_payments_booking_idx").on(t.bookingId, t.receivedOn),
    index("booking_payments_received_idx").on(t.receivedOn),
    check("booking_payments_amount_positive", sql`${t.amount} > 0`),
    // A payment has a receipt number and a method; a reversal has its own reference, the original and a reason.
    check(
      "booking_payments_kind_fields",
      sql`(${t.kind} = 'payment' and ${t.receiptNo} is not null and ${t.methodId} is not null and ${t.reversalOfId} is null and ${t.reversalRef} is null)
       or (${t.kind} = 'reversal' and ${t.reversalRef} is not null and ${t.reversalOfId} is not null and ${t.note} is not null and ${t.receiptNo} is null)`,
    ),
  ],
);

/** Accountant asks, manager / admin approves (proposed Q-F2 default). One pending request per payment. */
export const paymentReversalRequests = pgTable(
  "payment_reversal_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references((): AnyPgColumn => bookingPayments.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    status: reversalRequestStatus("status").notNull().default("pending"),
    requestedById: uuid("requested_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decidedById: uuid("decided_by_id").references(() => users.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_reversal_one_pending_uq").on(t.paymentId).where(sql`${t.status} = 'pending'`),
    index("payment_reversal_status_idx").on(t.status, t.createdAt),
    check("payment_reversal_decided_fields", sql`(${t.status} = 'pending') = (${t.decidedAt} is null)`),
  ],
);

/** FR-200 / FR-201: income and expense entries share one ledger table. */
export const financeEntryKind = pgEnum("finance_entry_kind", ["income", "expense"]);

/** Income and expense categories (Q-F4: the client's lists, entered by a Super Admin). Never deleted. */
export const financeCategories = pgTable(
  "finance_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: financeEntryKind("kind").notNull(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(100),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("finance_categories_kind_name_uq").on(t.kind, sql`lower(${t.name})`), check("finance_categories_name", sql`length(btrim(${t.name})) between 1 and 80`)],
);

/**
 * Income (FR-200) and expense (FR-201) records: category, amount, date, method, reference, payee
 * (expenses), note; attachments live in `files`. Never hard-deleted: a voided entry keeps its
 * figures and is left out of totals (same principle as payments, FR-206). Edits are audited.
 */
export const financeEntries = pgTable(
  "finance_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: financeEntryKind("kind").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => financeCategories.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 15, scale: 2, mode: "number" }).notNull(),
    entryDate: date("entry_date").notNull(),
    methodId: uuid("method_id").references(() => paymentMethods.id, { onDelete: "restrict" }),
    reference: text("reference"),
    payee: text("payee"),
    note: text("note"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedById: uuid("voided_by_id").references(() => users.id, { onDelete: "set null" }),
    voidReason: text("void_reason"),
    ...timestamps,
  },
  (t) => [
    index("finance_entries_kind_date_idx").on(t.kind, t.entryDate),
    check("finance_entries_amount_positive", sql`${t.amount} > 0`),
    check("finance_entries_payee_expense_only", sql`${t.payee} is null or ${t.kind} = 'expense'`),
    check("finance_entries_void_reason", sql`(${t.voidedAt} is null) = (${t.voidReason} is null)`),
    check("finance_entries_text_lengths", sql`coalesce(length(${t.reference}), 0) <= 120 and coalesce(length(${t.payee}), 0) <= 120 and coalesce(length(${t.note}), 0) <= 1000`),
  ],
);

/** Configurable finance display settings (receipt / reversal prefixes; final format pending Q-F3). */
export const financeSettings = pgTable("finance_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Tasks ────────────────────────────────────────────────────────────────────

/**
 * Proposal / payment-plan details kept on the task (DATA_MODEL.md §6). Figures are recomputed on
 * the server on every save; the snapshot keeps what was printed even if the unit later changes.
 */
export type TaskProposal = {
  customerName: string;
  preparedDate: string | null;
  preparedByName: string | null;
  preparedByTitle: string | null;
  projectId: string | null;
  printTitle: string | null;
  clientName: string | null;
  customHeader: string | null;
  unitId: string | null;
  unitDescription: string | null;
  apartmentNo: string | null;
  areaSqft: number | null;
  pricePerSqft: number | null;
  totalList: number | null;
  discountPct: number;
  afterDiscount: number | null;
  downPaymentPct: number;
  downPayment: number | null;
  installmentCount: number;
  eachInstallment: number | null;
  recurringLabel: string;
  freeNightVouchers: number | null;
  roiPerSqft: number | null;
  roiAnnual: number | null;
  /** "YYYY-MM": month of installment 1; installments fall on the 10th (Q43). Absent on older proposals. */
  firstInstallmentMonth?: string | null;
  bonuses: string | null;
  whyActNow: string | null;
  nextSteps: string | null;
};

/** FR-090 tasks. A proposal is a plan on paper only: it never posts or changes Finance records. */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    type: taskType("type").notNull().default("general"),
    status: taskStatus("status").notNull().default("open"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    assigneeId: uuid("assignee_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "restrict" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "restrict" }),
    description: text("description"),
    proposal: jsonb("proposal").$type<TaskProposal>(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("tasks_assignee_status_due_idx").on(t.assigneeId, t.status, t.dueAt),
    index("tasks_created_by_idx").on(t.createdById),
    index("tasks_lead_idx").on(t.leadId),
    index("tasks_booking_idx").on(t.bookingId),
    index("tasks_updated_idx").on(t.updatedAt),
    check("tasks_title_not_blank", sql`length(btrim(${t.title})) > 0`),
    // General tasks carry no plan; proposal / payment-plan tasks always do.
    check("tasks_proposal_matches_type", sql`(${t.type} = 'general') = (${t.proposal} is null)`),
    check("tasks_done_fields", sql`(${t.status} = 'done') = (${t.completedAt} is not null)`),
  ],
);

/** FR-091 proposed schedule rows (editable). Not payments; a booking payment plan's dated rows are its schedule for Finance "overdue" (FR-203). */
export const taskInstallmentRows = pgTable(
  "task_installment_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    progress: text("progress"),
    amount: numeric("amount", { precision: 16, scale: 2, mode: "number" }).notNull(),
    /** Due date (Q43: the 10th of each month). Null for the down payment and for older proposals. */
    dueOn: date("due_on"),
  },
  (t) => [
    uniqueIndex("task_installment_rows_task_seq_uq").on(t.taskId, t.seq),
    check("task_installment_rows_seq_positive", sql`${t.seq} > 0`),
    check("task_installment_rows_amount_non_negative", sql`${t.amount} >= 0`),
  ],
);

export const taskHistory = pgTable(
  "task_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("task_history_task_created_idx").on(t.taskId, t.createdAt)],
);

// ─── Teams operations & targets ───────────────────────────────────────────────

/**
 * FR-110 per-agent targets. Period starts are normalised (weekly = Monday, monthly = 1st);
 * achievement is computed from meetings and bookings, never stored.
 */
export const targets = pgTable(
  "targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    period: targetPeriod("period").notNull(),
    periodStart: date("period_start").notNull(),
    calls: integer("calls").notNull().default(0),
    meetings: integer("meetings").notNull().default(0),
    soldSqft: numeric("sold_sqft", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    setById: uuid("set_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("targets_user_period_start_uq").on(t.userId, t.period, t.periodStart),
    index("targets_period_start_idx").on(t.period, t.periodStart),
    check("targets_values_non_negative", sql`${t.calls} >= 0 and ${t.meetings} >= 0 and ${t.soldSqft} >= 0`),
    check("targets_weekly_monday", sql`${t.period} <> 'weekly' or extract(isodow from ${t.periodStart}) = 1`),
    check("targets_monthly_first", sql`${t.period} <> 'monthly' or extract(day from ${t.periodStart}) = 1`),
  ],
);

/** FR-121 manager daily report: one per team per date (manual entry, Q-H3 default). */
export const dailyReports = pgTable(
  "daily_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    reportDate: date("report_date").notNull(),
    submittedById: uuid("submitted_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("daily_reports_team_date_uq").on(t.teamId, t.reportDate), index("daily_reports_date_idx").on(t.reportDate)],
);

export const dailyReportLines = pgTable(
  "daily_report_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dailyReportId: uuid("daily_report_id")
      .notNull()
      .references(() => dailyReports.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    leads: integer("leads").notNull().default(0),
    calls: integer("calls").notNull().default(0),
    meetings: integer("meetings").notNull().default(0),
    tokens: integer("tokens").notNull().default(0),
    bookings: integer("bookings").notNull().default(0),
    remarks: text("remarks"),
  },
  (t) => [
    uniqueIndex("daily_report_lines_report_agent_uq").on(t.dailyReportId, t.agentId),
    check(
      "daily_report_lines_non_negative",
      sql`${t.leads} >= 0 and ${t.calls} >= 0 and ${t.meetings} >= 0 and ${t.tokens} >= 0 and ${t.bookings} >= 0`,
    ),
  ],
);

/** FR-122 duty roster: one status per person per day. On leave and Leads off stop automatic assignment that day. */
export const rosterEntries = pgTable(
  "roster_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    status: rosterStatus("status").notNull(),
    setById: uuid("set_by_id").references(() => users.id, { onDelete: "set null" }),
    /** Set when the entry was written by an approved leave (Q18), so cancelling removes only these. */
    leaveRequestId: uuid("leave_request_id").references((): AnyPgColumn => leaveRequests.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("roster_entries_user_date_uq").on(t.userId, t.date), index("roster_entries_team_date_idx").on(t.teamId, t.date)],
);

// ─── HR: leave ────────────────────────────────────────────────────────────────

/**
 * Leave requests (FR-142, questionnaire Q4–Q19). Days are calendar days, inclusive (Q8). A request
 * spanning two calendar years is accepted but held (not counted, not approvable) until the client
 * confirms how its days are deducted (Q17, clarification C-13).
 */
export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    type: leaveType("type").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    days: integer("days").notNull(),
    reason: text("reason"),
    status: leaveStatus("status").notNull().default("pending"),
    /** "senior": manager, HR, admin, super admin — approved by a Super Admin (Q7). "staff": the two configured steps (Q6). */
    approvalPath: text("approval_path").notNull(),
    /** Next approval step (1 or 2) while pending. */
    currentStep: integer("current_step").notNull().default(1),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("leave_requests_user_start_idx").on(t.userId, t.startDate),
    check("leave_requests_dates", sql`${t.startDate} <= ${t.endDate}`),
    check("leave_requests_days", sql`${t.days} = (${t.endDate} - ${t.startDate}) + 1`),
    check("leave_requests_path", sql`${t.approvalPath} in ('senior', 'staff')`),
    check("leave_requests_reason_length", sql`coalesce(length(${t.reason}), 0) <= 500`),
  ],
);

/** Each approval or cancellation decision on a leave request, in order. */
export const leaveDecisions = pgTable(
  "leave_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => leaveRequests.id, { onDelete: "cascade" }),
    /** "approval" step 1 / 2, "cancellation", "withdrawal" or "cancel_request". */
    kind: text("kind").notNull(),
    step: integer("step"),
    approved: boolean("approved").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("leave_decisions_request_idx").on(t.requestId, t.createdAt),
    // F-6: one approval decision per person per request, so the two staff steps are two different people.
    uniqueIndex("leave_decisions_one_approval_per_actor_uq").on(t.requestId, t.actorId).where(sql`${t.kind} = 'approval'`),
  ],
);

// ─── HR: holidays ─────────────────────────────────────────────────────────────

/**
 * FR-141 holiday calendar (DATA_MODEL §7). Company-wide holidays have no region; regional ones
 * carry a free-text region (HR plan Q9 default). One holiday per date per scope / region.
 */
export const holidays = pgTable(
  "holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date").notNull(),
    name: text("name").notNull(),
    scope: holidayScope("scope").notNull().default("company"),
    region: text("region"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("holidays_date_scope_region_uq").on(t.date, t.scope, sql`lower(coalesce(${t.region}, ''))`),
    index("holidays_date_idx").on(t.date),
    check("holidays_name_not_blank", sql`length(btrim(${t.name})) > 0`),
    check("holidays_region_matches_scope", sql`(${t.scope} = 'regional') = (${t.region} is not null and length(btrim(${t.region})) > 0)`),
  ],
);

// ─── HR: employee profiles ────────────────────────────────────────────────────

/**
 * FR-140 HR profile fields (HR plan §13, option B). For a CRM account, name, email, role and
 * status stay on `users`. Staff without a login (questionnaire Q1) have no `user_id`; their name,
 * email and employment status are kept here.
 */
export const employeeProfiles = pgTable(
  "employee_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The CRM account, when the employee has one. Staff without a login have none (Q1). */
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    /** Name, email and employment status of staff without a CRM login; accounts use `users`. */
    fullName: text("full_name"),
    email: text("email"),
    status: userStatus("status").notNull().default("active"),
    designation: text("designation"),
    department: text("department"),
    phoneCountryCode: text("phone_country_code"),
    phoneNumber: text("phone_number"),
    phoneE164: text("phone_e164"),
    joiningDate: date("joining_date"),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("employee_profiles_user_uq").on(t.userId),
    index("employee_profiles_department_idx").on(sql`lower(${t.department})`),
    check(
      "employee_profiles_phone_complete",
      sql`(${t.phoneE164} is null) = (${t.phoneCountryCode} is null) and (${t.phoneE164} is null) = (${t.phoneNumber} is null)`,
    ),
    check("employee_profiles_phone_e164_format", sql`${t.phoneE164} is null or ${t.phoneE164} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check("employee_profiles_text_lengths", sql`coalesce(length(${t.designation}), 0) <= 100 and coalesce(length(${t.department}), 0) <= 100`),
    check("employee_profiles_identity", sql`${t.userId} is not null or (${t.fullName} is not null and length(btrim(${t.fullName})) > 0)`),
    check("employee_profiles_record_lengths", sql`coalesce(length(${t.fullName}), 0) <= 100 and coalesce(length(${t.email}), 0) <= 254`),
  ],
);

// ─── Meetings ─────────────────────────────────────────────────────────────────

/** FR-100 meetings. Always linked to a lead (decision 29 Oct 2026); completed / cancelled are final. */
export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    type: meetingType("type"),
    location: text("location"),
    organizerId: uuid("organizer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "restrict" }),
    notes: text("notes"),
    status: meetingStatus("status").notNull().default("scheduled"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("meetings_organizer_status_starts_idx").on(t.organizerId, t.status, t.startsAt),
    index("meetings_lead_idx").on(t.leadId),
    index("meetings_created_by_idx").on(t.createdById),
    index("meetings_updated_idx").on(t.updatedAt),
    check("meetings_title_not_blank", sql`length(btrim(${t.title})) > 0`),
    check("meetings_ends_after_start", sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`),
    check("meetings_completed_fields", sql`(${t.status} = 'completed') = (${t.completedAt} is not null)`),
    check("meetings_cancelled_fields", sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`),
  ],
);

export const meetingHistory = pgTable(
  "meeting_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("meeting_history_meeting_created_idx").on(t.meetingId, t.createdAt)],
);

/** FR-009 admin app settings (key / value). Proposal defaults live here; values pending Q-B6. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Clients ──────────────────────────────────────────────────────────────────

/** Long-term buyer profile. One per person (normalised phone), across projects; leads link to it. */
export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    phoneCountryCode: text("phone_country_code").notNull(),
    phoneNumber: text("phone_number").notNull(),
    phoneE164: text("phone_e164").notNull(),
    email: text("email"),
    cityId: uuid("city_id").references(() => cities.id, { onDelete: "restrict" }),
    /** A city typed under "Other" (FR-042); city_id is then null. */
    cityOther: text("city_other"),
    relationship: clientRelationship("relationship"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "restrict" }),
    nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("clients_phone_e164_uq").on(t.phoneE164),
    index("clients_owner_idx").on(t.ownerId),
    index("clients_updated_idx").on(t.updatedAt),
    check("clients_phone_e164_format", sql`${t.phoneE164} ~ '^\\+[1-9][0-9]{6,14}$'`),
  ],
);

export const clientActivities = pgTable(
  "client_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    type: clientActivityType("type").notNull(),
    body: text("body"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("client_activities_client_created_idx").on(t.clientId, t.createdAt)],
);

export const clientFollowUps = pgTable(
  "client_follow_ups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    assigneeId: uuid("assignee_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    note: text("note"),
    status: followUpStatus("status").notNull().default("pending"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneById: uuid("done_by_id").references(() => users.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("client_follow_ups_client_idx").on(t.clientId),
    index("client_follow_ups_assignee_status_due_idx").on(t.assigneeId, t.status, t.dueAt),
  ],
);

export const rotationState = pgTable("rotation_state", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  lastUserId: uuid("last_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Documented notification events (FR-006; USER_FLOWS.md §1 "Notify owner", §3 lost request flow).
 * Nothing else raises notifications.
 */
export const notificationType = pgEnum("notification_type", [
  "lead_assigned",
  "lead_regenerated",
  "lost_requested",
  "lost_rejected",
  "follow_up_soon",
]);

/** In-app notifications (DATA_MODEL.md "notifications"). One row per recipient and event key, never duplicated. */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationType("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    /** In-app path of the related record, e.g. /dashboard/leads/<id>. */
    link: text("link"),
    /** Identifies the event (e.g. lost_requested:<approval id>); unique per recipient. */
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notifications_user_event_uq").on(t.userId, t.dedupeKey),
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
    index("notifications_user_unread_idx").on(t.userId).where(sql`${t.readAt} is null`),
    check("notifications_link_internal", sql`${t.link} is null or ${t.link} like '/dashboard/%'`),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_entity_idx").on(t.entity, t.entityId), index("audit_logs_created_idx").on(t.createdAt)],
);

// ─── Sprint (Nov 2026): phones, assignment audit, import batches, backups ───

/**
 * Extra phone numbers for a lead (positions 2–5). Position 1 stays on the lead row. All are
 * normalised to E.164 and every one of them is used for customer matching.
 */
export const leadPhones = pgTable(
  "lead_phones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    countryCode: text("country_code").notNull(),
    number: text("number").notNull(),
    e164: text("e164").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("lead_phones_lead_position_uq").on(t.leadId, t.position),
    uniqueIndex("lead_phones_lead_e164_uq").on(t.leadId, t.e164),
    index("lead_phones_e164_idx").on(t.e164),
    check("lead_phones_position_range", sql`${t.position} between 2 and 5`),
    check("lead_phones_e164_format", sql`${t.e164} ~ '^\\+[1-9][0-9]{6,14}$'`),
  ],
);

/** Extra phone numbers for a client (positions 2–5), as for leads. */
export const clientPhones = pgTable(
  "client_phones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    countryCode: text("country_code").notNull(),
    number: text("number").notNull(),
    e164: text("e164").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("client_phones_client_position_uq").on(t.clientId, t.position),
    uniqueIndex("client_phones_client_e164_uq").on(t.clientId, t.e164),
    index("client_phones_e164_idx").on(t.e164),
    check("client_phones_position_range", sql`${t.position} between 2 and 5`),
    check("client_phones_e164_format", sql`${t.e164} ~ '^\\+[1-9][0-9]{6,14}$'`),
  ],
);

/** How a lead got its owner. */
export const leadAssignmentMode = pgEnum("lead_assignment_mode", ["scored", "returning_customer", "claim", "manual", "creator", "import"]);

/** Every ownership decision with its reason and, for scored assignment, each candidate's breakdown. */
export const leadAssignments = pgTable(
  "lead_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    previousOwnerId: uuid("previous_owner_id").references(() => users.id, { onDelete: "set null" }),
    mode: leadAssignmentMode("mode").notNull(),
    reason: text("reason").notNull(),
    breakdown: jsonb("breakdown"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lead_assignments_lead_idx").on(t.leadId, t.createdAt), index("lead_assignments_assignee_idx").on(t.assigneeId, t.createdAt)],
);

export const importBatchStatus = pgEnum("import_batch_status", ["pending", "approved", "rejected"]);
export const importRowStatus = pgEnum("import_row_status", ["valid", "duplicate", "invalid", "created", "skipped"]);

/** A lead-import file submitted by an agent or manager. Nothing reaches the live pool until a Super Admin approves it. */
export const leadImportBatches = pgTable(
  "lead_import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    fileName: text("file_name"),
    uploadedById: uuid("uploaded_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: importBatchStatus("status").notNull().default("pending"),
    totalRows: integer("total_rows").notNull().default(0),
    validRows: integer("valid_rows").notNull().default(0),
    duplicateRows: integer("duplicate_rows").notNull().default(0),
    invalidRows: integer("invalid_rows").notNull().default(0),
    createdLeads: integer("created_leads").notNull().default(0),
    decidedById: uuid("decided_by_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lead_import_batches_status_idx").on(t.status, t.createdAt), index("lead_import_batches_uploader_idx").on(t.uploadedById)],
);

/** One row of an import batch, validated when submitted. */
export const leadImportRows = pgTable(
  "lead_import_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => leadImportBatches.id, { onDelete: "cascade" }),
    rowNo: integer("row_no").notNull(),
    data: jsonb("data").notNull(),
    phoneE164: text("phone_e164"),
    status: importRowStatus("status").notNull(),
    errors: jsonb("errors"),
    matchLeadId: uuid("match_lead_id").references(() => leads.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("lead_import_rows_batch_row_uq").on(t.batchId, t.rowNo), index("lead_import_rows_e164_idx").on(t.phoneE164)],
);

export const backupRunKind = pgEnum("backup_run_kind", ["backup", "restore", "restore_check", "prune"]);
export const backupRunStatus = pgEnum("backup_run_status", ["running", "succeeded", "failed"]);

/** Backup, restore and retention runs. Holds no backup contents and no credentials. */
export const backupRuns = pgTable(
  "backup_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: backupRunKind("kind").notNull(),
    status: backupRunStatus("status").notNull().default("running"),
    trigger: text("trigger").notNull(),
    location: text("location"),
    /** Bytes; 64-bit, since a backup with uploaded files can pass 2 GB. */
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    message: text("message"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("backup_runs_started_idx").on(t.startedAt)],
);
