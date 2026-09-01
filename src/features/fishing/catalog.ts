import type { Repo } from "../../db/index.ts";

export type FishTemplate = { name: string; rarity: string; point: number };

/** Fish templates grouped by rarity point; index is `point - 1`. */
export type Catalog = FishTemplate[][];

/** Roll weights per rarity point; points absent here are never rolled. */
export const RARITY_WEIGHTS: Record<number, number> = { 1: 50, 2: 20, 3: 10, 4: 5, 5: 1, 6: 0.1 };

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
