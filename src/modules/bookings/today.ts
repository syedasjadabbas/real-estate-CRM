import { BUSINESS_TIME_ZONE } from "@/modules/leads/constants";

/** Today's date (YYYY-MM-DD) in the business time zone; hold dates are compared against it. */
export function businessToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
