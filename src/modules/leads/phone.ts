export type NormalizedPhone = {
  countryCode: string; // "+92"
  national: string; // "3001234567" (no trunk 0)
  e164: string; // "+923001234567"
};

/**
 * A Pakistani mobile written with the country code but without "+" or "00": "92 300 1234567" or
 * "92 0300 1234567". Limited to the mobile shape (3 followed by nine digits) on purpose: Kohat's
 * landline area code is 922, so a bare leading "92" can't be dropped from every number.
 */
const PK_MOBILE_WITH_BARE_CODE = /^92(0?3\d{9})$/;

/**
 * Normalises a phone to E.164 from a country code and a number typed in any common format
 * ("0300-1234567", "300 1234567", "+92 300 1234567", "0092 300 1234567", "92 300 1234567").
 * Returns null when it cannot be valid.
 */
export function normalizePhone(countryCodeInput: string, numberInput: string): NormalizedPhone | null {
  const cc = countryCodeInput.replace(/\D/g, "");
  if (!/^[1-9]\d{0,3}$/.test(cc)) return null;

  let digits = numberInput.replace(/\D/g, "");
  // Number typed with its own international prefix: "+92…" or "0092…".
  if (numberInput.trim().startsWith("+") && digits.startsWith(cc)) digits = digits.slice(cc.length);
  else if (digits.startsWith(`00${cc}`)) digits = digits.slice(cc.length + 2);
  // "92 300 1234567": the country code typed without "+", which would otherwise become +92 92….
  else if (cc === "92" && PK_MOBILE_WITH_BARE_CODE.test(digits)) digits = digits.slice(2);
  // Trunk prefix used in national format (e.g. 0300… in Pakistan).
  digits = digits.replace(/^0+/, "");

  if (digits.length < 6 || cc.length + digits.length > 15) return null;
  return { countryCode: `+${cc}`, national: digits, e164: `+${cc}${digits}` };
}

/** Display format: "+92 300 1234567" style grouping for readability. */
export function formatPhone(countryCode: string, national: string) {
  const groups = national.length > 7 ? [national.slice(0, 3), national.slice(3)] : [national];
  return `${countryCode} ${groups.join(" ")}`;
}

/** `tel:` link for the device dialer (click-to-call); digits and a leading + only. */
export function telHref(countryCode: string, national: string) {
  return `tel:+${`${countryCode}${national}`.replace(/\D/g, "")}`;
}
