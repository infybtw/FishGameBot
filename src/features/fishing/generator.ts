import { round2 } from "../../lib/format.ts";
import { betaSample, randomInt } from "../../lib/random.ts";
import { CHANCE_UP_RARITY_WEIGHTS, RARITY_WEIGHTS, type Catalog, type FishTemplate } from "./catalog.ts";

export type CaughtFish = {
  name: string;
  rarity: string;
  point: number;
  sizeCm: number;
  weightG: number;
  price: number;
  catcherFirstName: string;
};

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

/** Builds the complete catch for a known rarity point; throws when its group is empty. */
export function generateCatch(catalog: Catalog, point: number, catcherFirstName: string): CaughtFish {
  const template = pickTemplate(catalog, point);
  const sizeCm = generateSize(point);
  const weightG = generateWeight(sizeCm);
  const price = generatePrice(point, weightG);
  return {
    name: template.name,
    rarity: template.rarity,
    point,
    sizeCm,
    weightG,
    price,
    catcherFirstName,
  };
}

export function tryCatch(
  catalog: Catalog,
  catcherFirstName: string,
  successChance: number,
  rarityStepBonus: number,
): CaughtFish | null {
  if (!didCatch(successChance)) return null;
  return generateCatch(catalog, rollPoint(catalog, rarityStepBonus), catcherFirstName);
}

/**
 * Guaranteed chance-up catch: rolls only with `CHANCE_UP_RARITY_WEIGHTS`,
 * so rarity point 1 is unreachable and only boosted points can be selected.
 */
export function boostedCatch(catalog: Catalog, catcherFirstName: string, rarityStepBonus = 0): CaughtFish {
  return generateCatch(catalog, rollPoint(catalog, rarityStepBonus, Math.random, CHANCE_UP_RARITY_WEIGHTS), catcherFirstName);
}

/**
 * Display-only fake catch: rarity point 5 or 6, each non-empty group equally
 * likely; throws when neither point has a catalog template.
 */
export function fakeFishCatch(catalog: Catalog, catcherFirstName: string): CaughtFish {
  const points = [5, 6].filter((point) => (catalog[point - 1]?.length ?? 0) > 0);
  if (points.length === 0) {
    throw new Error("No fish templates for rarity point 5 or 6");
  }
  return generateCatch(catalog, points[randomInt(0, points.length - 1)]!, catcherFirstName);
}
