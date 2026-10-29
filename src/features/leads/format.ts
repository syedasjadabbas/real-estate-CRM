import { BUSINESS_TIME_ZONE } from "@/modules/leads/constants";

const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: BUSINESS_TIME_ZONE,
});

/** "Oct 28, 2026, 10:55 AM" in business time (reference format). */
export function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "—";
  return dateTime.format(new Date(value));
}

/** Compact duration: "35m", "9h", "38d 18h". */
export function formatDuration(ms: number | null | undefined) {
  if (ms == null || ms < 0) return "—";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 0)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

export function since(value: Date | string | null | undefined, now = Date.now()) {
  if (!value) return "—";
  return formatDuration(now - new Date(value).getTime());
}

/** Value for <input type="datetime-local"> in the business time zone. */
export function toLocalInputValue(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Interprets a datetime-local value as business time (UTC+5, no DST) and returns ISO. */
export function fromLocalInputValue(value: string) {
  return new Date(`${value}:00+05:00`).toISOString();
}
