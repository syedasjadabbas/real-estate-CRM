/**
 * Property sizes (client, 24 Nov 2026). A lead keeps the size in the customer's words and the square feet
 * worked out from it, so 1 kanal, 20 marla and 4,500 sq ft are one size. A marla isn't the same everywhere,
 * so each project has its own (default 225). Words that don't say a size clearly are kept and flagged, never
 * guessed. No database access: the form uses it too.
 */
export const DEFAULT_MARLA_SQFT = 225;
const MARLAS_PER_KANAL = 20;
const SQFT_PER_SQYD = 9;

export const SIZE_UNITS = ["marla", "kanal", "sq ft", "sq yd"] as const;
export type SizeUnit = (typeof SIZE_UNITS)[number];
/** The sizes offered first, on the lead form and on campaign forms alike. */
export const SIZE_PRESETS = ["3 marla", "5 marla", "7 marla", "10 marla", "1 kanal", "2 kanal"] as const;

export const PROPERTY_TYPES = ["house", "villa", "apartment", "plot", "farmhouse", "shop", "office"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];
export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = { house: "House", villa: "Villa", apartment: "Apartment", plot: "Plot", farmhouse: "Farmhouse", shop: "Shop", office: "Office" };

const TYPE_WORDS: [PropertyType, RegExp][] = [
  ["farmhouse", /\bfarm\s*houses?\b/],
  ["house", /\b(houses?|homes?|makan)\b/],
  ["villa", /\bvillas?\b/],
  ["apartment", /\b(apartments?|flats?)\b/],
  ["plot", /\bplots?\b/],
  ["shop", /\bshops?\b/],
  ["office", /\boffices?\b/],
];

/** The property type a word or phrase names; null when none, or more than one. */
export function parsePropertyType(text: string): PropertyType | null {
  let rest = text.toLowerCase();
  const found: PropertyType[] = [];
  for (const [type, re] of TYPE_WORDS) {
    if (re.test(rest)) {
      found.push(type);
      rest = rest.replace(re, " ");
    }
  }
  return found.length === 1 ? found[0] : null;
}

const UNIT = /(\d+(?:\.\d+)?)\s*(kanals?|marlas?|sq(?:uare)?\.?\s*(?:ft|feet|foot)\.?|sqft|sft|sq(?:uare)?\.?\s*(?:yds?|yards?)\.?|sqyds?|gaz)(?![a-z])/g;
const unitOf = (word: string): SizeUnit => (word.startsWith("kanal") ? "kanal" : word.startsWith("marla") ? "marla" : /yd|yard|gaz/.test(word) ? "sq yd" : "sq ft");

export type ParsedSize = { parts: { value: number; unit: SizeUnit }[]; sqft: number };

/** Square feet of a size in words, or null when the words don't give exactly one size. */
export function parseSize(text: string, marlaSqft = DEFAULT_MARLA_SQFT): ParsedSize | null {
  let rest = text.toLowerCase().replace(/(\d),(?=\d{3})/g, "$1");
  const parts: ParsedSize["parts"] = [];
  rest = rest.replace(UNIT, (_, value: string, word: string) => {
    parts.push({ value: Number(value), unit: unitOf(word) });
    return " ";
  });
  for (const [, re] of TYPE_WORDS) rest = rest.replace(re, " ");
  // Anything else left ("2 bed", "5-7", "or", "around") means the words say more than one clear size.
  if (parts.length === 0 || rest.replace(/\b(a|an|and|of)\b/g, " ").replace(/[\s+&,.]/g, "") !== "") return null;
  // Two parts only as "1 kanal 5 marla".
  if (parts.length > 2 || (parts.length === 2 && !(parts[0].unit === "kanal" && parts[1].unit === "marla"))) return null;
  const sqftOf = { kanal: MARLAS_PER_KANAL * marlaSqft, marla: marlaSqft, "sq ft": 1, "sq yd": SQFT_PER_SQYD };
  const sqft = Math.round(parts.reduce((sum, p) => sum + p.value * sqftOf[p.unit], 0) * 100) / 100;
  return sqft > 0 && sqft < 10_000_000 ? { parts, sqft } : null;
}

export const formatSqft = (sqft: number) => `${sqft.toLocaleString("en-US", { maximumFractionDigits: 2 })} sq ft`;

/** What a lead stores for a size in words: its square feet, and the type the words name when none was chosen. */
export function sizeFields(words: string | null | undefined, type: string | null | undefined, marlaSqft: number) {
  return { sizeSqft: words ? (parseSize(words, marlaSqft)?.sqft ?? null) : null, propertyType: type || (words ? parsePropertyType(words) : null) };
}
