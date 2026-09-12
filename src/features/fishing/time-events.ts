import { CHANCE_UP_RARITY_WEIGHTS } from "./catalog.ts";

/**
 * Global time-based events shared by every chat. An active event only tweaks
 * the parameters of a single /fish attempt: success chance, rarity weights,
 * cooldown duration, or the reward. Player data and the fish catalog stay
 * untouched.
 */
export type TimeEventId = "dawn_bite" | "golden_hour" | "calm" | "night_trophy" | "moon_pool";

/** What an active event changes in a /fish attempt; neutral values change nothing. */
export type FishingModifiers = {
  /** Percentage points added to the success chance, capped at 100 by the caller. */
  readonly successChanceBonusPoints: number;
  /** Replacement rarity weights for ordinary rolls; null keeps the default ones. */
  readonly rarityWeights: Readonly<Record<number, number>> | null;
  /** New cooldowns last `CATCH_DELAY / cooldownDivisor` (rounded up to a second). */
  readonly cooldownDivisor: number;
  /** Caught fish price multiplier inside [priceMultiplierMinPoint, priceMultiplierMaxPoint]. */
  readonly priceMultiplier: number;
  readonly priceMultiplierMinPoint: number;
  readonly priceMultiplierMaxPoint: number;
  /** When set, every successful catch rolls rarity with exactly these weights. */
  readonly guaranteedRarityWeights: Readonly<Record<number, number>> | null;
};

/** One scheduled event: local [startHour, endHour) window on the listed weekdays. */
export type TimeEvent = {
  readonly id: TimeEventId;
  readonly name: string;
  readonly emoji: string;
  /** Short effect summary shown in messages and announcements. */
  readonly effect: string;
  /** Weekdays when the event runs, 0 = Sunday … 6 = Saturday, in the event time zone. */
  readonly days: readonly number[];
  /** Inclusive window start, full hour in the event time zone. */
  readonly startHour: number;
  /** Exclusive window end, full hour in the event time zone. */
  readonly endHour: number;
  readonly modifiers: FishingModifiers;
};

/** An event occurrence resolved against a concrete moment. */
export type ActiveTimeEvent = {
  readonly event: TimeEvent;
  /** Inclusive UTC start of the occurrence. */
  readonly startsAt: Date;
  /** Exclusive UTC end of the occurrence. */
  readonly endsAt: Date;
};

/** Modifiers used when no event is active; every value is a no-op. */
export const NEUTRAL_MODIFIERS: FishingModifiers = {
  successChanceBonusPoints: 0,
  rarityWeights: null,
  cooldownDivisor: 1,
  priceMultiplier: 1,
  priceMultiplierMinPoint: 1,
  priceMultiplierMaxPoint: 6,
  guaranteedRarityWeights: null,
};

/** Golden hour redistributes rarity odds toward higher tiers; weights sum to 100. */
export const GOLDEN_HOUR_RARITY_WEIGHTS: Readonly<Record<number, number>> = {
  1: 45,
  2: 30,
  3: 15,
  4: 7,
  5: 2.5,
  6: 0.5,
};

const EVERY_DAY: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
const WEEKEND: readonly number[] = [0, 6];

/**
 * The immutable global schedule. Windows never overlap, never cross midnight,
 * and stay within one local day, so at most one event is active at a time.
 */
export const TIME_EVENTS: readonly TimeEvent[] = Object.freeze([
  {
    id: "dawn_bite",
    name: "Рассветный клёв",
    emoji: "🌅",
    effect: "шанс успешной поклёвки +20 п.п.",
    days: EVERY_DAY,
    startHour: 6,
    endHour: 8,
    modifiers: { ...NEUTRAL_MODIFIERS, successChanceBonusPoints: 20 },
  },
  {
    id: "golden_hour",
    name: "Золотой час",
    emoji: "✨",
    effect: "усиленные шансы редкой рыбы",
    days: EVERY_DAY,
    startHour: 12,
    endHour: 13,
    modifiers: { ...NEUTRAL_MODIFIERS, rarityWeights: GOLDEN_HOUR_RARITY_WEIGHTS },
  },
  {
    id: "calm",
    name: "Штиль",
    emoji: "🌊",
    effect: "кулдаун /fish вдвое короче",
    days: EVERY_DAY,
    startHour: 15,
    endHour: 16,
    modifiers: { ...NEUTRAL_MODIFIERS, cooldownDivisor: 2 },
  },
  {
    id: "night_trophy",
    name: "Ночной трофей",
    emoji: "🌙",
    effect: "цена рыб редкости 4–6 ×1.5",
    days: EVERY_DAY,
    startHour: 22,
    endHour: 23,
    modifiers: { ...NEUTRAL_MODIFIERS, priceMultiplier: 1.5, priceMultiplierMinPoint: 4, priceMultiplierMaxPoint: 6 },
  },
  {
    id: "moon_pool",
    name: "Лунная заводь",
    emoji: "🌌",
    effect: "улов гарантированно редкости 2–6, персональный буст не тратится",
    days: WEEKEND,
    startHour: 0,
    endHour: 2,
    modifiers: { ...NEUTRAL_MODIFIERS, guaranteedRarityWeights: CHANCE_UP_RARITY_WEIGHTS },
  },
]);

export type TimeZoneParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function timeZoneFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
}

/** Calendar fields of an instant as seen in `timeZone`; throws on an unknown zone. */
export function getTimeZoneParts(date: Date, timeZone: string): TimeZoneParts {
  const fields = new Map<string, string>();
  for (const part of timeZoneFormatter(timeZone).formatToParts(date)) fields.set(part.type, part.value);
  const weekday = WEEKDAY_INDEX[fields.get("weekday") ?? ""];
  if (weekday === undefined) throw new Error(`Cannot read weekday in time zone ${timeZone}`);
  return {
    year: Number(fields.get("year")),
    month: Number(fields.get("month")),
    day: Number(fields.get("day")),
    hour: Number(fields.get("hour")) % 24,
    minute: Number(fields.get("minute")),
    second: Number(fields.get("second")),
    weekday,
  };
}

/** Offset (ms) to add to a UTC timestamp to get wall-clock time in `timeZone`. */
function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getTimeZoneParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

/** UTC instant of the given wall-clock time in `timeZone`; two passes handle DST. */
function localToUtcDate(parts: TimeZoneParts, timeZone: string, hour: number): Date {
  const guessUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour);
  let result = new Date(guessUtc - timeZoneOffsetMs(new Date(guessUtc), timeZone));
  result = new Date(guessUtc - timeZoneOffsetMs(result, timeZone));
  return result;
}

/**
 * The event whose [start, end) window contains `now`, or null. Intervals are
 * inclusive on the left and exclusive on the right; `now` is passed in so the
 * function stays pure and fully testable.
 */
export function getActiveTimeEvent(now: Date, timeZone: string): ActiveTimeEvent | null {
  const parts = getTimeZoneParts(now, timeZone);
  for (const event of TIME_EVENTS) {
    if (!event.days.includes(parts.weekday)) continue;
    const startsAt = localToUtcDate(parts, timeZone, event.startHour);
    const endsAt = localToUtcDate(parts, timeZone, event.endHour);
    if (startsAt.getTime() <= now.getTime() && now.getTime() < endsAt.getTime()) {
      return { event, startsAt, endsAt };
    }
  }
  return null;
}

/** The earliest event start strictly after `now`; always exists within a week. */
export function getNextTimeEvent(now: Date, timeZone: string): ActiveTimeEvent {
  const today = getTimeZoneParts(now, timeZone);
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    // Noon on the shifted calendar date keeps weekday arithmetic exact across DST.
    const day = getTimeZoneParts(new Date(Date.UTC(today.year, today.month - 1, today.day + dayOffset, 12)), timeZone);
    let best: ActiveTimeEvent | null = null;
    for (const event of TIME_EVENTS) {
      if (!event.days.includes(day.weekday)) continue;
      const startsAt = localToUtcDate(day, timeZone, event.startHour);
      if (startsAt.getTime() <= now.getTime()) continue;
      if (best !== null && best.startsAt.getTime() <= startsAt.getTime()) continue;
      best = { event, startsAt, endsAt: localToUtcDate(day, timeZone, event.endHour) };
    }
    // Later day offsets can only hold later starts, so the first hit wins.
    if (best !== null) return best;
  }
  throw new Error("Schedule invariant broken: no upcoming time event within a week");
}

/** Effective modifiers of the attempt: the active event's own or neutral ones. */
export function getFishingModifiers(active: ActiveTimeEvent | null): FishingModifiers {
  return active === null ? NEUTRAL_MODIFIERS : active.event.modifiers;
}

/** The active occurrence right now; `nowMs` keeps call sites testable. */
export function getActiveTimeEventNow(timeZone: string, nowMs: number = Date.now()): ActiveTimeEvent | null {
  return getActiveTimeEvent(new Date(nowMs), timeZone);
}

/** Whether a persisted event occurrence identity refers to this active event. */
export function isTimeEventOccurrence(active: ActiveTimeEvent, occurrence: { eventId: string; startedAt: number } | null): boolean {
  return occurrence !== null && occurrence.eventId === active.event.id && occurrence.startedAt === active.startsAt.getTime() / 1000;
}

/** New cooldown duration during an event, rounded up to a whole second. */
export function eventCooldownSeconds(catchDelaySeconds: number, modifiers: FishingModifiers): number {
  return Math.ceil(catchDelaySeconds / modifiers.cooldownDivisor);
}

/** "ЧЧ:ММ" wall-clock time of an instant in `timeZone`. */
export function formatEventTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const DAY_NAMES = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"] as const;

/** Human-readable weekday list of a schedule entry, in Russian. */
export function formatEventDays(days: readonly number[]): string {
  if (days.length === 7) return "каждый день";
  if (days.length === 2 && days.includes(0) && days.includes(6)) return "сб и вс";
  return [...days].sort((a, b) => a - b).map((day) => DAY_NAMES[day]!).join(", ");
}

/** "ЧЧ:00–ЧЧ:00" window of a schedule entry; all events run whole hours. */
export function formatEventWindow(event: TimeEvent): string {
  const pad = (hour: number): string => String(hour).padStart(2, "0");
  return `${pad(event.startHour)}:00–${pad(event.endHour)}:00`;
}
