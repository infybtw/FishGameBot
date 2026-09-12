import { describe, expect, test } from "bun:test";
import {
  eventCooldownSeconds,
  formatEventTime,
  getActiveTimeEvent,
  getFishingModifiers,
  getNextTimeEvent,
  NEUTRAL_MODIFIERS,
  TIME_EVENTS,
  type TimeEvent,
} from "./time-events.ts";

const TZ = "Europe/Moscow";

/** UTC instant of the given Moscow wall-clock time (MSK is UTC+3 all year). */
function msk(year: number, month: number, day: number, hour: number, minute = 0, second = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 3, minute, second));
}

function activeEvent(date: Date): TimeEvent | null {
  return getActiveTimeEvent(date, TZ)?.event ?? null;
}

// Wednesday, Saturday, and Sunday fixtures: the schedule spans both branches.
const WEDNESDAY = { year: 2026, month: 9, day: 9 };
const SATURDAY = { year: 2026, month: 9, day: 12 };

describe("getActiveTimeEvent boundaries", () => {
  test("dawn bite runs on [06:00, 08:00)", () => {
    expect(activeEvent(msk(WEDNESDAY.year, 9, 9, 5, 59, 59))).toBeNull();
    expect(activeEvent(msk(WEDNESDAY.year, 9, 9, 6, 0, 0))?.id).toBe("dawn_bite");
    expect(activeEvent(msk(WEDNESDAY.year, 9, 9, 7, 59, 59))?.id).toBe("dawn_bite");
    expect(activeEvent(msk(WEDNESDAY.year, 9, 9, 8, 0, 0))).toBeNull();
  });

  test("golden hour runs on [12:00, 13:00)", () => {
    expect(activeEvent(msk(2026, 9, 9, 11, 59, 59))).toBeNull();
    expect(activeEvent(msk(2026, 9, 9, 12, 0, 0))?.id).toBe("golden_hour");
    expect(activeEvent(msk(2026, 9, 9, 12, 59, 59))?.id).toBe("golden_hour");
    expect(activeEvent(msk(2026, 9, 9, 13, 0, 0))).toBeNull();
  });

  test("calm runs on [15:00, 16:00)", () => {
    expect(activeEvent(msk(2026, 9, 9, 14, 59, 59))).toBeNull();
    expect(activeEvent(msk(2026, 9, 9, 15, 0, 0))?.id).toBe("calm");
    expect(activeEvent(msk(2026, 9, 9, 16, 0, 0))).toBeNull();
  });

  test("night trophy runs on [22:00, 23:00)", () => {
    expect(activeEvent(msk(2026, 9, 9, 21, 59, 59))).toBeNull();
    expect(activeEvent(msk(2026, 9, 9, 22, 0, 0))?.id).toBe("night_trophy");
    expect(activeEvent(msk(2026, 9, 9, 23, 0, 0))).toBeNull();
  });

  test("moon pool runs on weekend [00:00, 02:00) only", () => {
    expect(activeEvent(msk(2026, 9, 11, 23, 59, 59))).toBeNull(); // Friday night
    expect(activeEvent(msk(2026, 9, 12, 0, 0, 0))?.id).toBe("moon_pool");
    expect(activeEvent(msk(2026, 9, 12, 1, 59, 59))?.id).toBe("moon_pool");
    expect(activeEvent(msk(2026, 9, 12, 2, 0, 0))).toBeNull();
    expect(activeEvent(msk(2026, 9, 13, 0, 30))?.id).toBe("moon_pool"); // Sunday
    expect(activeEvent(msk(2026, 9, 14, 0, 30))).toBeNull(); // Monday
    expect(activeEvent(msk(2026, 9, 9, 0, 30))).toBeNull(); // Wednesday
  });
});

describe("getActiveTimeEvent UTC conversion", () => {
  test("resolves Moscow windows from UTC instants", () => {
    // 06:00 MSK is 03:00 UTC.
    expect(getActiveTimeEvent(new Date("2026-09-09T03:00:00Z"), TZ)?.event.id).toBe("dawn_bite");
    expect(getActiveTimeEvent(new Date("2026-09-09T04:59:59Z"), TZ)?.event.id).toBe("dawn_bite");
    expect(getActiveTimeEvent(new Date("2026-09-09T05:00:00Z"), TZ)).toBeNull();
    // 12:00 MSK is 09:00 UTC.
    expect(getActiveTimeEvent(new Date("2026-09-09T09:00:00Z"), TZ)?.event.id).toBe("golden_hour");
    expect(getActiveTimeEvent(new Date("2026-09-09T10:00:00Z"), TZ)).toBeNull();
  });

  test("reports the occurrence window as UTC dates", () => {
    const active = getActiveTimeEvent(msk(2026, 9, 9, 12, 30), TZ)!;
    expect(active.startsAt.toISOString()).toBe("2026-09-09T09:00:00.000Z");
    expect(active.endsAt.toISOString()).toBe("2026-09-09T10:00:00.000Z");
  });

  test("UTC midnight lands in the weekend moon pool window", () => {
    // Saturday 00:30 MSK is Friday 21:30 UTC.
    const active = getActiveTimeEvent(new Date("2026-09-11T21:30:00Z"), TZ)!;
    expect(active.event.id).toBe("moon_pool");
    expect(active.startsAt.toISOString()).toBe("2026-09-11T21:00:00.000Z");
    expect(active.endsAt.toISOString()).toBe("2026-09-11T23:00:00.000Z");
  });

  test("rejects an unknown time zone", () => {
    expect(() => getActiveTimeEvent(msk(2026, 9, 9, 12), "Mars/Olympus")).toThrow();
  });
});

describe("getNextTimeEvent", () => {
  test("picks the later event on the same day", () => {
    const next = getNextTimeEvent(msk(2026, 9, 9, 13, 0), TZ);
    expect(next.event.id).toBe("calm");
    expect(next.startsAt.toISOString()).toBe("2026-09-09T12:00:00.000Z");
  });

  test("skips to the weekend for the moon pool", () => {
    // Friday 23:30 MSK: all Friday events have passed, Saturday opens with the moon pool.
    const next = getNextTimeEvent(msk(2026, 9, 11, 23, 30), TZ);
    expect(next.event.id).toBe("moon_pool");
    expect(next.startsAt.toISOString()).toBe("2026-09-11T21:00:00.000Z");
    expect(next.endsAt.toISOString()).toBe("2026-09-11T23:00:00.000Z");
  });

  test("moves past the running event to the same-day dawn bite", () => {
    // Saturday 00:30 MSK, inside moon pool: dawn bite starts at 06:00 MSK.
    const next = getNextTimeEvent(msk(SATURDAY.year, 9, 12, 0, 30), TZ);
    expect(next.event.id).toBe("dawn_bite");
    expect(next.startsAt.toISOString()).toBe("2026-09-12T03:00:00.000Z");
  });

  test("rolls over to the next day after the last window", () => {
    const next = getNextTimeEvent(msk(2026, 9, 9, 23, 59, 59), TZ);
    // Thursday 00:00 MSK is a weekday, so the moon pool is skipped.
    expect(next.event.id).toBe("dawn_bite");
    expect(next.startsAt.toISOString()).toBe("2026-09-10T03:00:00.000Z");
  });
});

describe("fishing modifiers", () => {
  test("neutral modifiers change nothing", () => {
    expect(getFishingModifiers(null)).toEqual(NEUTRAL_MODIFIERS);
    expect(eventCooldownSeconds(3600, NEUTRAL_MODIFIERS)).toBe(3600);
  });

  test("each event exposes only its own effect", () => {
    const byId = new Map(TIME_EVENTS.map((event) => [event.id, event]));
    expect(byId.get("dawn_bite")!.modifiers).toEqual({ ...NEUTRAL_MODIFIERS, successChanceBonusPoints: 20 });
    expect(byId.get("golden_hour")!.modifiers.rarityWeights).toEqual({ 1: 45, 2: 30, 3: 15, 4: 7, 5: 2.5, 6: 0.5 });
    expect(byId.get("calm")!.modifiers).toEqual({ ...NEUTRAL_MODIFIERS, cooldownDivisor: 2 });
    expect(byId.get("night_trophy")!.modifiers).toEqual({
      ...NEUTRAL_MODIFIERS,
      priceMultiplier: 1.5,
      priceMultiplierMinPoint: 4,
      priceMultiplierMaxPoint: 6,
    });
    expect(byId.get("moon_pool")!.modifiers.guaranteedRarityWeights).toEqual({ 2: 45, 3: 30, 4: 15, 5: 7, 6: 3 });
  });

  test("golden hour weights sum to 100", () => {
    const weights = TIME_EVENTS.find((event) => event.id === "golden_hour")!.modifiers.rarityWeights!;
    expect(Object.values(weights).reduce((sum, weight) => sum + weight, 0)).toBe(100);
  });

  test("calm halves cooldowns with rounding up to a second", () => {
    const calm = getFishingModifiers(getActiveTimeEvent(msk(2026, 9, 9, 15, 30), TZ));
    expect(eventCooldownSeconds(3600, calm)).toBe(1800);
    expect(eventCooldownSeconds(3601, calm)).toBe(1801);
    expect(eventCooldownSeconds(0, calm)).toBe(0);
  });
});

describe("formatEventTime", () => {
  test("renders wall-clock time in the requested zone", () => {
    expect(formatEventTime(new Date("2026-09-09T09:00:00Z"), TZ)).toBe("12:00");
    expect(formatEventTime(new Date("2026-09-09T09:00:00Z"), "UTC")).toBe("09:00");
    expect(formatEventTime(new Date("2026-09-11T21:00:00Z"), TZ)).toBe("00:00");
  });
});
