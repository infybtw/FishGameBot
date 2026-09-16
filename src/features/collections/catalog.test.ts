import { describe, expect, test } from "bun:test";
import type { Catalog } from "../fishing/catalog.ts";
import {
  aggregateCollectionBuffs,
  collectionEffectLabel,
  collectionProgress,
  collectionRequirements,
  getCollection,
} from "./catalog.ts";

const CATALOG: Catalog = [
  [
    { name: "Карась", rarity: "Обычная", point: 1 },
    { name: "Окунь", rarity: "Обычная", point: 1 },
  ],
  [{ name: "Щука", rarity: "Редкая", point: 2 }],
  [{ name: "Сом", rarity: "Эпическая", point: 3 }],
  [{ name: "Белуга", rarity: "Легендарная", point: 4 }],
  [{ name: "Кракен", rarity: "Мифическая", point: 5 }],
  [{ name: "Золотая рыбка", rarity: "Радужная", point: 6 }],
];

function requireCollection(id: string) {
  const collection = getCollection(id);
  expect(collection).toBeDefined();
  return collection!;
}

describe("collection requirements", () => {
  test("a rarity collection requires the configured copies of every fish of that point", () => {
    expect(collectionRequirements(requireCollection("rarity_1"), CATALOG)).toEqual([
      { name: "Карась", count: 2 },
      { name: "Окунь", count: 2 },
    ]);
    expect(collectionRequirements(requireCollection("rarity_3"), CATALOG)).toEqual([{ name: "Сом", count: 1 }]);
  });

  test("a thematic collection is intersected with the live catalog and uses per-name counts", () => {
    expect(collectionRequirements(requireCollection("river"), CATALOG)).toEqual([
      { name: "Карась", count: 3 },
      { name: "Окунь", count: 3 },
      { name: "Сом", count: 1 },
      { name: "Щука", count: 2 },
    ]);
  });

  test("thematic names missing from the catalog are dropped", () => {
    expect(collectionRequirements(requireCollection("legends"), CATALOG)).toEqual([
      { name: "Золотая рыбка", count: 1 },
      { name: "Кракен", count: 1 },
    ]);
  });

  test("a collection with no catalog matches is unavailable", () => {
    const empty: Catalog = [];
    const progress = collectionProgress(requireCollection("rarity_1"), empty, new Map());
    expect(progress).toMatchObject({ requirements: [], total: 0, owned: 0, ready: false, available: false });
  });
});

describe("collection progress", () => {
  test("counts owned copies up to each requirement and lists the missing names", () => {
    const progress = collectionProgress(requireCollection("rarity_1"), CATALOG, new Map([["Карась", 2]]));
    expect(progress.requirements).toEqual([
      { name: "Карась", required: 2, owned: 2 },
      { name: "Окунь", required: 2, owned: 0 },
    ]);
    expect(progress.owned).toBe(2);
    expect(progress.total).toBe(4);
    expect(progress.missing).toEqual(["Окунь"]);
    expect(progress.ready).toBe(false);
    expect(progress.available).toBe(true);
  });

  test("surplus copies do not exceed the requirement", () => {
    const progress = collectionProgress(requireCollection("rarity_1"), CATALOG, new Map([["Карась", 5], ["Окунь", 3]]));
    expect(progress.owned).toBe(4);
    expect(progress.ready).toBe(true);
    expect(progress.missing).toEqual([]);
  });

  test("a partial multi-count requirement is not ready", () => {
    const progress = collectionProgress(requireCollection("river"), CATALOG, new Map([["Карась", 2], ["Окунь", 3], ["Щука", 2]]));
    expect(progress.missing).toEqual(["Карась", "Сом"]);
    expect(progress.ready).toBe(false);
  });
});

describe("collection buff aggregation", () => {
  test("sums additive effects and multiplies price effects", () => {
    const totals = aggregateCollectionBuffs(["rarity_1", "rarity_2", "legends", "rarity_6", "unknown_id"]);
    expect(totals.catchChancePoints).toBe(2);
    expect(totals.rarityStepBonus).toBeCloseTo(0.03, 10);
    expect(totals.modifierChancePoints).toBe(0);
    expect(totals.priceMultiplier).toBeCloseTo(1.2 * 1.15, 10);
  });

  test("no completed collections leaves every buff neutral", () => {
    expect(aggregateCollectionBuffs([])).toEqual({
      catchChancePoints: 0,
      rarityStepBonus: 0,
      modifierChancePoints: 0,
      priceMultiplier: 1,
    });
  });
});

describe("collection effect labels", () => {
  test("describe each effect kind", () => {
    expect(collectionEffectLabel({ kind: "catch_chance", points: 3 })).toBe("Шанс поймать рыбу: +3 п.п.");
    expect(collectionEffectLabel({ kind: "rarity_step", bonus: 0.05 })).toBe("Бонус редкости: +5% за шаг");
    expect(collectionEffectLabel({ kind: "modifier_chance", points: 4 })).toBe("Шанс модификатора: +4 п.п.");
    expect(collectionEffectLabel({ kind: "price_multiplier", multiplier: 1.2 })).toBe("Цена рыбы: ×1.2");
  });
});

describe("collection catalog", () => {
  test("every id is unique and resolvable", () => {
    const ids = ["rarity_1", "rarity_2", "rarity_3", "rarity_4", "rarity_5", "rarity_6", "river", "predators", "deep", "legends"];
    for (const id of ids) expect(getCollection(id)?.id).toBe(id);
    expect(getCollection("missing")).toBeUndefined();
  });
});
