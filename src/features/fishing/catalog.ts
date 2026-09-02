import type { Repo } from "../../db/index.ts";

export type FishTemplate = { name: string; rarity: string; point: number };

/** Fish templates grouped by rarity point; index is `point - 1`. */
export type Catalog = FishTemplate[][];

/** Chance of each rarity point among successful catches; values sum to 100%. */
export const RARITY_WEIGHTS: Readonly<Record<number, number>> = {
  1: 72,
  2: 20,
  3: 6,
  4: 1.5,
  5: 0.4,
  6: 0.1,
};

export async function loadCatalog(repo: Repo): Promise<Catalog> {
  const catalog: Catalog = [];
  for (const template of await repo.loadAllTemplates()) {
    (catalog[template.point - 1] ??= []).push(template);
  }
  return catalog;
}

let currentCatalog: Catalog = [];

export function setCatalog(catalog: Catalog): void {
  currentCatalog = catalog;
}

export function getCatalog(): Catalog {
  return currentCatalog;
}
