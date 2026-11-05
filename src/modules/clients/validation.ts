import { cityChoiceSchema, cityOtherSchema } from "@/modules/cities/validation";
import { z } from "zod";
import { CLIENT_SORT_COLUMNS, RELATIONSHIPS } from "./constants";

const optionalUuid = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.uuid("Invalid selection").optional());

const optionalRelationship = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.enum(RELATIONSHIPS, "Choose a relationship").optional());

export const clientFieldsSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  phoneCountryCode: z
    .string()
    .trim()
    .regex(/^\+?[1-9]\d{0,3}$/, "Invalid country code"),
  phoneNumber: z.string().trim().min(6, "Phone number is required").max(25),
  email: z
    .string()
    .trim()
    .max(160)
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(z.email("Enter a valid email").optional()),
  cityId: cityChoiceSchema,
  cityOther: cityOtherSchema,
  relationship: optionalRelationship,
});

/** Manual create (admins). Owner defaults to the creator when omitted. */
export const createClientSchema = clientFieldsSchema.extend({ ownerId: optionalUuid });
export type CreateClientInput = z.input<typeof createClientSchema>;

/** Partial edit: no defaults, so omitted fields stay as they are. Empty strings clear optional fields. */
export const updateClientSchema = clientFieldsSchema.partial();
export type UpdateClientInput = z.input<typeof updateClientSchema>;

export const convertLeadSchema = z.object({
  leadId: z.uuid("Choose a lead"),
  /** When the lead's phone already belongs to a visible client: "reject" warns, "link" attaches the lead to it. */
  onExisting: z.enum(["reject", "link"]).default("reject"),
});

/**
 * List query parsed from URL search params. Invalid values fall back to defaults.
 * The reference shows only search and "Has investment in project"; the latter needs Bookings.
 */
export const clientListQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  /** "Has investment in project" filter. */
  project: z.string().uuid().optional().catch(undefined),
  sort: z.enum(CLIENT_SORT_COLUMNS).catch("updatedAt"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type ClientListQuery = z.output<typeof clientListQuerySchema>;
