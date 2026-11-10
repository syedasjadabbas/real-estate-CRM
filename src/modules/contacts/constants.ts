/** Safe for client components: no Zod here (building a schema in the browser trips the CSP). */

/** A lead or client holds up to five numbers: the primary one on its own row, then positions 2–5. */
export const MAX_PHONES = 5;
export const MAX_EXTRA_PHONES = MAX_PHONES - 1;

export type ExtraPhoneInput = { countryCode: string; number: string };

/** Four empty slots for the form. */
export const emptyExtraPhones = (): ExtraPhoneInput[] =>
  Array.from({ length: MAX_EXTRA_PHONES }, () => ({ countryCode: "+92", number: "" }));

/** The form's slots filled from saved numbers, padded to four. */
export function extraPhoneSlots(saved: { countryCode: string; number: string }[]): ExtraPhoneInput[] {
  const slots = emptyExtraPhones();
  saved.slice(0, MAX_EXTRA_PHONES).forEach((p, i) => (slots[i] = { countryCode: p.countryCode, number: p.number }));
  return slots;
}

/**
 * Quick check before submitting: enough digits to be a phone number. The server normalises and
 * decides; this only catches obvious mistakes early.
 */
export function looksLikePhone(value: string) {
  return looksLikePhoneNumber(value);
}

/** Errors for the first number and the extra slots, keyed like the server's field errors. */
export function phoneFormErrors(primary: string, extras: ExtraPhoneInput[]) {
  const errors: Record<string, string> = {};
  if (!primary.trim()) errors.phoneNumber = "Phone number is required";
  else if (!looksLikePhoneNumber(primary)) errors.phoneNumber = "Enter a valid phone number";
  extras.forEach((p, i) => {
    if (p.number.trim() && !looksLikePhoneNumber(p.number)) errors[`phones.${i}`] = "Enter a valid phone number";
  });
  return errors;
}

function looksLikePhoneNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 15 && !/[a-z]/i.test(value);
}
