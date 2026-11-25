/**
 * What a lead form accepts (client, 25 Nov 2026). Safe for client components: no Zod, no database. Checked again
 * on the server when a lead is added, imported, or its name or number changes, so older records still save.
 */
export const NAME_PREFIXES = ["Mr", "Mrs", "Ms", "Dr", "Engr", "Prof"] as const;
const PREFIX = /^(mr|mrs|ms|miss|dr|engr|eng|prof|col|maj|gen|capt|brig)\.?\s+/i;

/** "Mr Ali" → { prefix: "Mr", rest: "Ali" }. Titles not on the list stay in the name. */
export function splitPrefix(firstName: string) {
  const word = `${firstName} `.match(PREFIX)?.[1];
  const prefix = NAME_PREFIXES.find((p) => p.toLowerCase() === word?.toLowerCase()) ?? "";
  return prefix ? { prefix, rest: `${firstName.trimStart()} `.replace(PREFIX, "").replace(/ $/, "") } : { prefix: "", rest: firstName };
}

/** Letters in any script, spaces and . ' - & / ( ). */
export function nameProblem(value: string, label = "Name") {
  const v = value.trim();
  if (!v) return null;
  if (/\d/.test(v)) return `${label} can't contain numbers`;
  if (!/^[\p{L}\p{M}\s.'’\-&/()]+$/u.test(v)) return `${label} has a character that isn't allowed`;
  if (!/\p{L}{2,}/u.test(v)) return `${label} is too short`;
  return null;
}

/** Mobile numbers by country: digits after the country code (no leading 0), and how they start. */
const MOBILE: Record<string, { lengths: number[]; starts?: RegExp; example: string }> = {
  "92": { lengths: [10], starts: /^3/, example: "0300 1234567" },
  "971": { lengths: [9], starts: /^5/, example: "50 123 4567" },
  "966": { lengths: [9], starts: /^5/, example: "50 123 4567" },
  "974": { lengths: [8], starts: /^[3567]/, example: "3312 3456" },
  "968": { lengths: [8], starts: /^[79]/, example: "9212 3456" },
  "965": { lengths: [8], starts: /^[4569]/, example: "5012 3456" },
  "973": { lengths: [8], starts: /^[36]/, example: "3612 3456" },
  "44": { lengths: [10], starts: /^7/, example: "7400 123456" },
  "1": { lengths: [10], starts: /^[2-9][0-9]{2}[2-9]/, example: "201 555 0123" },
  "61": { lengths: [9], starts: /^4/, example: "412 345 678" },
  "49": { lengths: [10, 11], starts: /^1/, example: "1512 3456789" },
};

/** The digits after the country code, however the number was typed. */
function nationalDigits(cc: string, number: string) {
  let digits = number.replace(/\D/g, "");
  if (number.trim().startsWith("+") && digits.startsWith(cc)) digits = digits.slice(cc.length);
  else if (digits.startsWith(`00${cc}`)) digits = digits.slice(cc.length + 2);
  else if (cc === "92" && /^920?3\d{9}$/.test(digits)) digits = digits.slice(2);
  else if (cc === "1" && /^1[0-9]{10}$/.test(digits)) digits = digits.slice(1);
  return digits.replace(/^0+/, "");
}

/** What a mobile number of that country looks like. */
export const phoneExample = (countryCode: string) => MOBILE[countryCode.replace(/\D/g, "")]?.example ?? "300 1234567";

/** More digits than any number of that country has. */
export function isPhoneTooLong(countryCode: string, number: string) {
  const cc = countryCode.replace(/\D/g, "");
  return nationalDigits(cc, number).length > Math.max(...(MOBILE[cc]?.lengths ?? [15 - cc.length]));
}

/** A further number may be a landline, so only its length is checked. */
export function extraPhoneProblem(countryCode: string, number: string) {
  if (/[a-z]/i.test(number)) return "A phone number has digits only";
  const digits = nationalDigits(countryCode.replace(/\D/g, ""), number);
  if (digits.length < 7) return "The number is too short";
  return isPhoneTooLong(countryCode, number) ? `The number is too long for ${countryCode}` : null;
}

/** Why a number can't be a mobile in that country, or null when it can. `national` may be as typed. */
export function phoneProblem(countryCode: string, number: string) {
  const cc = countryCode.replace(/\D/g, "");
  if (/[a-z]/i.test(number)) return "A phone number has digits only";
  if (!/\d/.test(number)) return "Phone number is required";
  const digits = nationalDigits(cc, number);
  const rule = MOBILE[cc];
  if (!rule) return digits.length >= 6 && cc.length + digits.length <= 15 ? null : "Enter a valid phone number";
  if (!rule.lengths.includes(digits.length)) return `+${cc} numbers have ${rule.lengths.join(" or ")} digits after the code, e.g. ${rule.example}`;
  if (rule.starts && !rule.starts.test(digits)) return `That isn't a +${cc} mobile number, e.g. ${rule.example}`;
  if (/^(\d)\1+$/.test(digits)) return "Enter a real phone number";
  return null;
}

/** Field errors for a new lead's form or request, keyed like the server's. Only what is present is checked. */
export function leadInputErrors(input: Record<string, unknown>) {
  const errors: Record<string, string> = {};
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string).trim() : undefined);
  const first = str("firstName");
  const put = (k: string, problem: string | null) => {
    if (problem) errors[k] = problem;
  };
  if (first !== undefined) put("firstName", splitPrefix(first).rest.trim() ? nameProblem(splitPrefix(first).rest, "First name") : "First name is required");
  else if (str("name")) put("name", nameProblem(str("name")!));
  if (str("lastName")) put("lastName", nameProblem(str("lastName")!, "Last name"));
  if (str("phoneNumber") !== undefined) put("phoneNumber", phoneProblem(str("phoneCountryCode") ?? "+92", str("phoneNumber")!));
  if (Array.isArray(input.phones)) {
    (input.phones as { countryCode?: unknown; number?: unknown }[]).forEach((p, i) => {
      const number = typeof p?.number === "string" ? p.number.trim() : "";
      if (number) put(`phones.${i}`, extraPhoneProblem(String(p.countryCode ?? "+92"), number));
    });
  }
  const email = str("email");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = "Enter a valid email, e.g. name@example.com";
  return errors;
}
