import { randomInt } from "node:crypto";

/** Capital letters and digits, without the pairs people mix up (0/O, 1/I/L). */
const LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";
const DIGITS = "23456789";

/**
 * Random 8-character lead code with letters and digits (client, 23 Nov 2026), e.g. "K7P4X9MB".
 * Uniqueness is enforced by the database; codes given before this stay as they are (letters only).
 */
export function generateLeadCode() {
  for (;;) {
    let code = "";
    for (let i = 0; i < 8; i += 1) code += (LETTERS + DIGITS)[randomInt(LETTERS.length + DIGITS.length)];
    if (/[A-Z]/.test(code) && /[0-9]/.test(code)) return code;
  }
}
