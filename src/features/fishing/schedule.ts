import { getTimeZoneParts } from "./time-events.ts";

/**
 * The global fishing schedule: an optional last day of fishing, shared by every
 * chat. It is stored as an ISO `YYYY-MM-DD` date; while set, /fish stops
 * working after that calendar day in the bot's event time zone.
 */

/**
 * Parses a `ДД.ММ.ГГГГ` date into an ISO `YYYY-MM-DD` string. Returns null for
 * anything that is not a real calendar date, so impossible days like 31.02 are
 * rejected instead of silently rolling over.
 */
export function parseEndDate(raw: string): string | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw.trim());
  if (match === null) return null;
  const [, dayRaw, monthRaw, yearRaw] = match;
  const day = Number(dayRaw);
  const month = Number(monthRaw);
  const year = Number(yearRaw);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  return isRealDate ? `${yearRaw}-${monthRaw}-${dayRaw}` : null;
}

/** Formats an ISO `YYYY-MM-DD` date back as `ДД.ММ.ГГГГ` for messages. */
export function formatEndDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}.${month}.${year}`;
}

/** Whether the season is over: today is after the last allowed fishing day. */
export function isFishingEnded(endDate: string, now: Date, timeZone: string): boolean {
  const parts = getTimeZoneParts(now, timeZone);
  const today = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  return today > endDate;
}
