import type { Catalog } from "../fishing/catalog.ts";

/**
 * Collection catalog. A collection is completed by handing in one available
 * catch of every required fish; completing it permanently grants its effect.
 * Definitions live in code so balance edits ship with deploys, while the
 * required fish are resolved against the live (admin-editable) catalog.
 */
export type CollectionEffect =
  | { kind: "catch_chance"; points: number }
  | { kind: "rarity_step"; bonus: number }
  | { kind: "modifier_chance"; points: number }
  | { kind: "price_multiplier"; multiplier: number };

export type CollectionRequirement = {
  /** Whole rarity groups: every catalog fish with one of these points. */
  points?: readonly number[];
  /** Exact fish names, intersected with the live catalog. */
  names?: readonly string[];
};

export type CollectionDefinition = {
  id: string;
  name: string;
  description: string;
  requirement: CollectionRequirement;
  effect: CollectionEffect;
};

export const COLLECTIONS: readonly CollectionDefinition[] = [
  {
    id: "rarity_1",
    name: "Обычная коллекция",
    description: "Все обычные рыбы чата.",
    requirement: { points: [1] },
    effect: { kind: "catch_chance", points: 2 },
  },
  {
    id: "rarity_2",
    name: "Необычная коллекция",
    description: "Все необычные рыбы чата.",
    requirement: { points: [2] },
    effect: { kind: "rarity_step", bonus: 0.03 },
  },
  {
    id: "rarity_3",
    name: "Редкая коллекция",
    description: "Все редкие рыбы чата.",
    requirement: { points: [3] },
    effect: { kind: "modifier_chance", points: 4 },
  },
  {
    id: "rarity_4",
    name: "Эпическая коллекция",
    description: "Все эпические рыбы чата.",
    requirement: { points: [4] },
    effect: { kind: "rarity_step", bonus: 0.06 },
  },
  {
    id: "rarity_5",
    name: "Легендарная коллекция",
    description: "Все легендарные рыбы чата.",
    requirement: { points: [5] },
    effect: { kind: "modifier_chance", points: 8 },
  },
  {
    id: "rarity_6",
    name: "Мифическая коллекция",
    description: "Все мифические рыбы чата.",
    requirement: { points: [6] },
    effect: { kind: "price_multiplier", multiplier: 1.2 },
  },
  {
    id: "river",
    name: "Речные обитатели",
    description: "Классическая речная рыба.",
    requirement: { names: ["Окунь", "Карась", "Щука", "Судак", "Сом", "Осётр"] },
    effect: { kind: "catch_chance", points: 3 },
  },
  {
    id: "predators",
    name: "Хищники",
    description: "Опасные охотники водоёмов.",
    requirement: { names: ["Щука", "Судак", "Сом", "Угорь", "Кракен"] },
    effect: { kind: "rarity_step", bonus: 0.05 },
  },
  {
    id: "deep",
    name: "Глубины",
    description: "Обитатели тёмных глубин.",
    requirement: { names: ["Сом", "Осётр", "Белуга", "Угорь", "Кракен"] },
    effect: { kind: "modifier_chance", points: 6 },
  },
  {
    id: "legends",
    name: "Легенды",
    description: "Рыбы, о которых слагают мифы.",
    requirement: { names: ["Золотая рыбка", "Кракен", "Радужная форель", "Призрачный лещ"] },
    effect: { kind: "price_multiplier", multiplier: 1.15 },
  },
];

const collectionsById: ReadonlyMap<string, CollectionDefinition> = new Map(
  COLLECTIONS.map((collection) => [collection.id, collection]),
);

export function getCollection(id: string): CollectionDefinition | undefined {
  return collectionsById.get(id);
}

export type CollectionBuffTotals = {
  catchChancePoints: number;
  rarityStepBonus: number;
  modifierChancePoints: number;
  priceMultiplier: number;
};

export const EMPTY_COLLECTION_BUFFS: Readonly<CollectionBuffTotals> = {
  catchChancePoints: 0,
  rarityStepBonus: 0,
  modifierChancePoints: 0,
  priceMultiplier: 1,
};

/** Sums the permanent effects of every completed collection. */
export function aggregateCollectionBuffs(collectionIds: readonly string[]): CollectionBuffTotals {
  const totals: CollectionBuffTotals = { ...EMPTY_COLLECTION_BUFFS };
  for (const id of collectionIds) {
    const collection = getCollection(id);
    if (collection === undefined) continue;
    switch (collection.effect.kind) {
      case "catch_chance":
        totals.catchChancePoints += collection.effect.points;
        break;
      case "rarity_step":
        totals.rarityStepBonus += collection.effect.bonus;
        break;
      case "modifier_chance":
        totals.modifierChancePoints += collection.effect.points;
        break;
      case "price_multiplier":
        totals.priceMultiplier *= collection.effect.multiplier;
        break;
    }
  }
  return totals;
}

/** One-line summary of every active collection bonus for profile and menu headers. */
export function collectionBuffSummary(totals: CollectionBuffTotals): string {
  const parts: string[] = [];
  if (totals.catchChancePoints > 0) parts.push(`+${totals.catchChancePoints} п.п. к поимке`);
  if (totals.rarityStepBonus > 0) parts.push(`+${Math.round(totals.rarityStepBonus * 100)}% к редкости`);
  if (totals.modifierChancePoints > 0) parts.push(`+${totals.modifierChancePoints} п.п. к модификатору`);
  if (totals.priceMultiplier > 1) parts.push(`×${totals.priceMultiplier} к цене`);
  return parts.length === 0 ? "пока нет" : parts.join(", ");
}

/** Human-readable effect text shared by the menu and the reward announcement. */
export function collectionEffectLabel(effect: CollectionEffect): string {
  switch (effect.kind) {
    case "catch_chance":
      return `Шанс поймать рыбу: +${effect.points} п.п.`;
    case "rarity_step":
      return `Бонус редкости: +${Math.round(effect.bonus * 100)}% за шаг`;
    case "modifier_chance":
      return `Шанс модификатора: +${effect.points} п.п.`;
    case "price_multiplier":
      return `Цена рыбы: ×${effect.multiplier}`;
  }
}

/**
 * Names that must be handed in, resolved against the live catalog. Rarity
 * groups contribute every current fish; thematic names are intersected so an
 * admin-removed fish never blocks completion. Sorted for stable display.
 */
export function collectionRequiredNames(collection: CollectionDefinition, catalog: Catalog): string[] {
  const names = new Set<string>();
  for (const group of catalog) {
    for (const template of group) {
      const byPoint = collection.requirement.points?.includes(template.point) ?? false;
      const byName = collection.requirement.names?.includes(template.name) ?? false;
      if (byPoint || byName) names.add(template.name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, "ru"));
}

export type CollectionProgress = {
  required: readonly string[];
  /** Required fish the player currently has at least one available copy of. */
  owned: number;
  missing: readonly string[];
  total: number;
  /** True when every required fish is present and can be handed in. */
  ready: boolean;
  /** False when the live catalog no longer contains any required fish. */
  available: boolean;
};

export function collectionProgress(
  collection: CollectionDefinition,
  catalog: Catalog,
  availableByName: ReadonlyMap<string, number>,
): CollectionProgress {
  const required = collectionRequiredNames(collection, catalog);
  const missing = required.filter((name) => (availableByName.get(name) ?? 0) <= 0);
  const owned = required.length - missing.length;
  return {
    required,
    owned,
    missing,
    total: required.length,
    ready: required.length > 0 && missing.length === 0,
    available: required.length > 0,
  };
}
