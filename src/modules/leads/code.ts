import { randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Random 8-letter lead code (reference format, e.g. "OVFQOVJR"). Uniqueness is enforced by the DB. */
export function generateLeadCode() {
  let code = "";
  for (let i = 0; i < 8; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}
