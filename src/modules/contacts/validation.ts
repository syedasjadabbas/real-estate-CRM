import { z } from "zod";
import { MAX_EXTRA_PHONES } from "./constants";

/** Up to four extra numbers (positions 2–5); blank slots are ignored. Checked fully on the server. */
export const extraPhonesSchema = z
  .array(z.object({ countryCode: z.string().trim().max(5).default("+92"), number: z.string().trim().max(25).default("") }))
  .max(MAX_EXTRA_PHONES, `Use at most ${MAX_EXTRA_PHONES} additional numbers`)
  .optional();
