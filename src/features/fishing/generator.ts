import type { Config } from "../../config.ts";
import { round2 } from "../../lib/format.ts";
import { betaSample, randomInt } from "../../lib/random.ts";
import { RARITY_WEIGHTS, type Catalog, type FishTemplate } from "./catalog.ts";

export type CaughtFish = {
  name: string;
  rarity: string;
  point: number;
  sizeCm: number;
  weightG: number;
  price: number;
  catcherFirstName: string;
};

export function rollPoint(catalog: Catalog): number {
  const entries: Array<{ point: number; weight: number }> = [];
  for (let point = 1; point <= catalog.length; point++) {
    const group = catalog[point - 1];
    if (group === undefined || group.length === 0) continue;
    const weight = RARITY_WEIGHTS[point] ?? 0;
    if (weight <= 0) continue;
    entries.push({ point, weight });
  }
  if (entries.length === 0) {
    throw new Error("Cannot roll a rarity point: fish catalog is empty");
  }
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
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

export function tryCatch(catalog: Catalog, cfg: Config, catcherFirstName: string): CaughtFish | null {
  if (randomInt(0, 100) > cfg.catchSuccessChance) return null;
  const point = rollPoint(catalog);
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
