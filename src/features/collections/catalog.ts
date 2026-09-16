import type { Catalog } from "../fishing/catalog.ts";

/**
 * Collection catalog. A collection is completed by handing in the required
 * copies of every required fish; completing it permanently grants its effect.
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
  /** Copies required per resolved fish name; defaults to 1. */
  count?: number;
  /** Per-name copy counts that override `count` for the listed names. */
  counts?: Readonly<Record<string, number>>;
};

/** One resolved requirement: hand in `count` copies of a fish name. */
export type CollectionRequirementItem = { name: string; count: number };

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
    description: "Все обычные рыбы чата по 2 экземпляра.",
    requirement: { points: [1], count: 2 },
    effect: { kind: "catch_chance", points: 2 },
  },
  {
    id: "rarity_2",
    name: "Необычная коллекция",
    description: "Все необычные рыбы чата по 2 экземпляра.",
    requirement: { points: [2], count: 2 },
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
    description: "Классическая речная рыба: мелкой нужно больше.",
    requirement: {
      names: ["Окунь", "Карась", "Щука", "Судак", "Сом", "Осётр"],
      counts: { Окунь: 3, Карась: 3, Щука: 2, Судак: 2 },
    },
    effect: { kind: "catch_chance", points: 3 },
  },
  {
    id: "predators",
    name: "Хищники",
    description: "Опасные охотники водоёмов.",
    requirement: {
      names: ["Щука", "Судак", "Сом", "Угорь", "Кракен"],
      counts: { Щука: 2, Судак: 2, Сом: 2 },
    },
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
 * Requirements that must be handed in, resolved against the live catalog.
 * Rarity groups contribute every current fish; thematic names are intersected
 * so an admin-removed fish never blocks completion. Sorted for stable display.
 */
export function collectionRequirements(collection: CollectionDefinition, catalog: Catalog): CollectionRequirementItem[] {
  const counts = new Map<string, number>();
  for (const group of catalog) {
    for (const template of group) {
      const byPoint = collection.requirement.points?.includes(template.point) ?? false;
      const byName = collection.requirement.names?.includes(template.name) ?? false;
      if (!byPoint && !byName) continue;
      counts.set(template.name, collection.requirement.counts?.[template.name] ?? collection.requirement.count ?? 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

/** Required copies of one fish and how many the player currently owns. */
export type CollectionRequirementProgress = { name: string; required: number; owned: number };

export type CollectionProgress = {
  requirements: readonly CollectionRequirementProgress[];
  /** Copies the player can hand in right now. */
  owned: number;
  missing: readonly string[];
  /** Total copies the collection requires. */
  total: number;
  /** True when every required copy is present and can be handed in. */
  ready: boolean;
  /** False when the live catalog no longer contains any required fish. */
  available: boolean;
};

export function collectionProgress(
  collection: CollectionDefinition,
  catalog: Catalog,
  availableByName: ReadonlyMap<string, number>,
): CollectionProgress {
  const requirements = collectionRequirements(collection, catalog).map((item) => ({
    name: item.name,
    required: item.count,
    owned: availableByName.get(item.name) ?? 0,
  }));
  const missing = requirements.filter((item) => item.owned < item.required).map((item) => item.name);
  const owned = requirements.reduce((sum, item) => sum + Math.min(item.owned, item.required), 0);
  const total = requirements.reduce((sum, item) => sum + item.required, 0);
  return {
    requirements,
    owned,
    missing,
    total,
    ready: requirements.length > 0 && missing.length === 0,
    available: requirements.length > 0,
  };
}
