import { expect, test } from "bun:test";
import { formatEndDate, isFishingEnded, parseEndDate } from "./schedule.ts";

test("parseEndDate accepts real dd.mm.yyyy dates, including leap days, and trims input", () => {
  expect(parseEndDate("01.01.1970")).toBe("1970-01-01");
  expect(parseEndDate("29.02.2024")).toBe("2024-02-29");
  expect(parseEndDate(" 31.12.2026 ")).toBe("2026-12-31");
});

test("parseEndDate rejects malformed, impossible, and non-dddd dates", () => {
  expect(parseEndDate("")).toBeNull();
  expect(parseEndDate("31.02.2024")).toBeNull();
  expect(parseEndDate("29.02.2023")).toBeNull();
  expect(parseEndDate("1.1.1970")).toBeNull();
  expect(parseEndDate("1970-01-01")).toBeNull();
  expect(parseEndDate("01/01/1970")).toBeNull();
  expect(parseEndDate("00.01.2000")).toBeNull();
  expect(parseEndDate("01.13.2000")).toBeNull();
});

test("formatEndDate renders an ISO date as dd.mm.yyyy", () => {
  expect(formatEndDate("1970-01-01")).toBe("01.01.1970");
  expect(formatEndDate("2026-12-31")).toBe("31.12.2026");
});

test("the last day is inclusive: fishing ends only after it, in the event time zone", () => {
  // 28.09 12:00 UTC is still 28.09 in Moscow; the last day is not over yet.
  expect(isFishingEnded("2026-09-28", new Date("2026-09-28T12:00:00Z"), "Europe/Moscow")).toBe(false);
  // 28.09 23:00 UTC is already 29.09 in Moscow (UTC+3).
  expect(isFishingEnded("2026-09-28", new Date("2026-09-28T23:00:00Z"), "Europe/Moscow")).toBe(true);
  expect(isFishingEnded("2026-09-28", new Date("2026-09-29T00:00:00Z"), "Europe/Moscow")).toBe(true);
});
