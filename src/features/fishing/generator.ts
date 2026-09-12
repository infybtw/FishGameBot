import { round2 } from "../../lib/format.ts";
import { betaSample, randomInt } from "../../lib/random.ts";
import { CHANCE_UP_RARITY_WEIGHTS, RARITY_WEIGHTS, type Catalog, type FishTemplate } from "./catalog.ts";
import { FISH_MODIFIERS, type FishModifier } from "./modifiers.ts";

export type CaughtFish = {
  name: string;
  rarity: string;
  point: number;
  sizeCm: number;
  weightG: number;
  price: number;
  modifier: FishModifier | null;
  catcherFirstName: string;
};

/** Event price adjustment: multiplies the price of fish in the point range. */
export type PriceModifier = { multiplier: number; minPoint: number; maxPoint: number };

export function didCatch(successChance: number, random: () => number = Math.random): boolean {
  return random() * 100 < successChance;
}

export function rollPoint(
  catalog: Catalog,
  rarityStepBonus = 0,
  random: () => number = Math.random,
  weights: Readonly<Record<number, number>> = RARITY_WEIGHTS,
): number {
  const entries: Array<{ point: number; weight: number }> = [];
  for (let point = 1; point <= catalog.length; point++) {
    const group = catalog[point - 1];
    if (group === undefined || group.length === 0) continue;
    const weight = (weights[point] ?? 0) * (1 + rarityStepBonus * (point - 1));
    if (weight <= 0) continue;
    entries.push({ point, weight });
  }
  if (entries.length === 0) {
    throw new Error("Cannot roll a rarity point: fish catalog is empty");
  }
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry.point;
  }
  return entries[entries.length - 1]!.point;
}

export function pickTemplate(catalog: Catalog, point: number): FishTemplate {
  const group = catalog[point - 1];
  if (group === undefined || group.length === 0) {
    throw new Error(`No fish templates for rarity point ${point}`);
  }
  return group[randomInt(0, group.length - 1)]!;
}

export function generateSize(point: number): number {
  const min = 10 * point;
  const max = 40 + 20 * (point - 1);
  return round2(min + (max - min) * betaSample(2, 8));
}

export function generateWeight(sizeCm: number): number {
  return round2(0.08 * sizeCm ** 3);
}

export function generatePrice(point: number, weightG: number): number {
  return round2(0.05 * point ** 2 * weightG + 200 * point);
}

/**
 * Separate modifier roll after a fish has been picked: `dropChance: 0` never
 * draws or consumes randomness; otherwise an exclusive percentage roll decides
 * the drop and a second weighted roll picks one of `FISH_MODIFIERS`.
 */
export function rollModifier(dropChance: number, random: () => number = Math.random): FishModifier | null {
  if (dropChance <= 0) return null;
  if (random() * 100 >= dropChance) return null;
  const total = FISH_MODIFIERS.reduce((sum, modifier) => sum + modifier.weight, 0);
  let roll = random() * total;
  for (const modifier of FISH_MODIFIERS) {
    roll -= modifier.weight;
    if (roll < 0) return modifier;
  }
  return FISH_MODIFIERS[FISH_MODIFIERS.length - 1]!;
}

/**
 * Builds the complete catch for a known rarity point; throws when its group is
 * empty. A won modifier roll scales the size first, then the weight is
 * recomputed from that size and the price from that weight, with every stored
 * value rounded once at the end.
 */
export function generateCatch(
  catalog: Catalog,
  point: number,
  catcherFirstName: string,
  modifierDropChance = 0,
  priceModifier?: PriceModifier,
): CaughtFish {
  const template = pickTemplate(catalog, point);
  const baseSizeCm = generateSize(point);
  const modifier = rollModifier(modifierDropChance);
  const sizeCm = round2(baseSizeCm * (modifier?.sizeMultiplier ?? 1));
  const weightG = generateWeight(sizeCm);
  let price = round2(generatePrice(point, weightG) * (modifier?.priceMultiplier ?? 1));
  if (priceModifier !== undefined && point >= priceModifier.minPoint && point <= priceModifier.maxPoint) {
    price = round2(price * priceModifier.multiplier);
  }
  return {
    name: template.name,
    rarity: template.rarity,
    point,
    sizeCm,
    weightG,
    price,
    modifier,
    catcherFirstName,
  };
}

export function tryCatch(
  catalog: Catalog,
  catcherFirstName: string,
  successChance: number,
  rarityStepBonus = 0,
  modifierDropChance = 0,
  rarityWeights: Readonly<Record<number, number>> = RARITY_WEIGHTS,
  priceModifier?: PriceModifier,
): CaughtFish | null {
  if (!didCatch(successChance)) return null;
  return generateCatch(catalog, rollPoint(catalog, rarityStepBonus, Math.random, rarityWeights), catcherFirstName, modifierDropChance, priceModifier);
}

/**
 * Guaranteed chance-up catch: rolls only with `CHANCE_UP_RARITY_WEIGHTS`,
 * so rarity point 1 is unreachable and only boosted points can be selected.
 */
export function boostedCatch(
  catalog: Catalog,
  catcherFirstName: string,
  rarityStepBonus = 0,
  modifierDropChance = 0,
  priceModifier?: PriceModifier,
): CaughtFish {
  return generateCatch(
    catalog,
    rollPoint(catalog, rarityStepBonus, Math.random, CHANCE_UP_RARITY_WEIGHTS),
    catcherFirstName,
    modifierDropChance,
    priceModifier,
  );
}

/**
 * Display-only fake catch: rarity point 5 or 6, each non-empty group equally
 * likely; throws when neither point has a catalog template.
 */
export function fakeFishCatch(catalog: Catalog, catcherFirstName: string, modifierDropChance = 0): CaughtFish {
  const points = [5, 6].filter((point) => (catalog[point - 1]?.length ?? 0) > 0);
  if (points.length === 0) {
    throw new Error("No fish templates for rarity point 5 or 6");
  }
  return generateCatch(catalog, points[randomInt(0, points.length - 1)]!, catcherFirstName, modifierDropChance);
}
