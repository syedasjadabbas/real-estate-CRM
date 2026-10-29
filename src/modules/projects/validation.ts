import { z } from "zod";
import { PROJECT_STATUSES, PROJECT_TYPES } from "./constants";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .optional()
    .transform((v) => (v ? v : undefined));

/** FR-060 fields: name, type, developer / company, location (city, address), status, description. */
export const projectFieldsSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120, "Use at most 120 characters"),
  type: z.enum(PROJECT_TYPES, "Choose a project type"),
  developer: optionalText(120),
  city: optionalText(80),
  address: optionalText(240),
  description: optionalText(2000),
  status: z.enum(PROJECT_STATUSES, "Choose a status"),
});

export const createProjectSchema = projectFieldsSchema.extend({
  type: z.enum(PROJECT_TYPES, "Choose a project type").default("building"),
  status: z.enum(PROJECT_STATUSES, "Choose a status").default("active"),
});
export type CreateProjectInput = z.input<typeof createProjectSchema>;

/** Partial edit: no defaults, so omitted fields stay as they are. Empty strings clear optional fields. */
export const updateProjectSchema = projectFieldsSchema.partial();
export type UpdateProjectInput = z.input<typeof updateProjectSchema>;

/** List query parsed from URL search params. Invalid values fall back to defaults. */
export const projectListQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  type: z.enum(PROJECT_TYPES).optional().catch(undefined),
  status: z.enum(PROJECT_STATUSES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type ProjectListQuery = z.output<typeof projectListQuerySchema>;

export { dimensionsSchema } from "@/modules/inventory/validation";
