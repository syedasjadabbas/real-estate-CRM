/** Browser checks, most specific first (Edge and Opera also send "Chrome", Chrome also sends "Safari"). */
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(e|A|iOS)?\//, "Edge"],
  [/\b(OPR|Opera)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(Firefox|FxiOS)\//, "Firefox"],
  [/\b(Chrome|CriOS|Chromium)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

/** Operating systems, most specific first (iPad and Android user agents also mention macOS or Linux). */
const SYSTEMS: [RegExp, string][] = [
  [/\b(iPhone|iPad|iPod)\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bWindows\b/, "Windows"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\b(Macintosh|Mac OS X)\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

const match = (ua: string, list: [RegExp, string][]) => list.find(([re]) => re.test(ua))?.[1] ?? null;

/**
 * Short label for a stored user agent, e.g. "Chrome · Windows". Only names that the string states are
 * used; anything else is "Unknown browser". The full user agent stays available for display on hover.
 */
export function browserLabel(userAgent: string | null | undefined) {
  const ua = userAgent?.trim() ?? "";
  if (!ua) return "Unknown browser";
  const browser = match(ua, BROWSERS);
  const system = match(ua, SYSTEMS);
  return [browser ?? "Unknown browser", system].filter(Boolean).join(" · ");
}
