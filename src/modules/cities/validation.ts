import { z } from "zod";
import { CITY_NAME_MAX, OTHER_CITY } from "./constants";

const NOT_A_NAME = "Enter a city name, not a number or phone number";
/** Letters in any script, with the spaces and punctuation real names use. Digits of every script fail. */
const CITY_NAME = /^\p{L}[\p{L}\p{M} .'’-]*$/u;

const normalize = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ");

/** FR-042: one rule for a typed "Other" city and for the managed list. Numbers and phone numbers are not cities. */
export const cityNameSchema = z
  .string()
  .transform(normalize)
  .pipe(
    z
      .string()
      .min(1, "Enter the city name")
      .max(CITY_NAME_MAX, `Use ${CITY_NAME_MAX} characters or fewer`)
      .regex(CITY_NAME, NOT_A_NAME)
      .refine((v) => (v.match(/\p{L}/gu) ?? []).length >= 2, "Enter the full city name")
      .refine((v) => v.toLowerCase() !== OTHER_CITY, "Enter the actual city name"),
  );

/** A list city's id, "other", or empty for not specified. */
export const cityChoiceSchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.union([z.uuid(), z.literal(OTHER_CITY)], { error: "Invalid selection" }).optional());

/** The typed name. Checked by `resolveCity`, because it only applies when "Other" is chosen. */
export const cityOtherSchema = z
  .string()
  .trim()
  .max(200, `Use ${CITY_NAME_MAX} characters or fewer`)
  .optional()
  .transform((v) => (v ? v : undefined));

export const createCitySchema = z.object({ name: cityNameSchema });
export const updateCitySchema = z.object({ name: cityNameSchema.optional(), isActive: z.boolean().optional() });
