/**
 * Self-contained curse roll model: probability bands and the balance
 * multiplier. No database or Telegram dependency.
 */
export type Curse =
  | { kind: "heavy_net"; name: "Проклятие тяжёлой сети" }
  | { kind: "second_cast"; name: "Проклятие второго заброса" }
  | { kind: "golden_scales"; name: "Проклятие золотой чешуи" };

export const CURSES: Readonly<Record<Curse["kind"], Curse>> = {
  heavy_net: { kind: "heavy_net", name: "Проклятие тяжёлой сети" },
  second_cast: { kind: "second_cast", name: "Проклятие второго заброса" },
  golden_scales: { kind: "golden_scales", name: "Проклятие золотой чешуи" },
};

/**
 * At most one curse per successful catch. `dropChance: 0` never draws;
 * otherwise one percentage roll decides the drop and a second one picks the
 * kind with fixed inclusive bands: 0–33 heavy_net, 34–66 second_cast,
 * 67–99 golden_scales.
 */
export function rollCurse(dropChance: number, random: () => number = Math.random): Curse | null {
  if (dropChance === 0) return null;
  if (random() * 100 >= dropChance) return null;
  const kindRoll = random() * 100;
  if (kindRoll <= 33) return CURSES.heavy_net;
  if (kindRoll <= 66) return CURSES.second_cast;
  return CURSES.golden_scales;
}

/** One of the 41 two-decimal values from 0.80 through 1.20 inclusive. */
export function rollBalanceMultiplier(random: () => number = Math.random): number {
  return Math.floor(random() * 41) / 100 + 0.8;
}
