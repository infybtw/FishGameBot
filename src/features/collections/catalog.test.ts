import { describe, expect, test } from "bun:test";
import type { Catalog } from "../fishing/catalog.ts";
import {
  aggregateCollectionBuffs,
  collectionEffectLabel,
  collectionProgress,
  collectionRequiredNames,
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

describe("collection required names", () => {
  test("a rarity collection requires every fish of that point", () => {
    expect(collectionRequiredNames(requireCollection("rarity_1"), CATALOG)).toEqual(["Карась", "Окунь"]);
  });

  test("a thematic collection is intersected with the live catalog", () => {
    expect(collectionRequiredNames(requireCollection("river"), CATALOG)).toEqual(["Карась", "Окунь", "Сом", "Щука"]);
  });

  test("thematic names missing from the catalog are dropped", () => {
    expect(collectionRequiredNames(requireCollection("legends"), CATALOG)).toEqual(["Золотая рыбка", "Кракен"]);
  });

  test("a collection with no catalog matches is unavailable", () => {
    const empty: Catalog = [];
    const progress = collectionProgress(requireCollection("rarity_1"), empty, new Map());
    expect(progress).toMatchObject({ required: [], total: 0, owned: 0, ready: false, available: false });
  });
});

describe("collection progress", () => {
  test("counts owned fish and lists the missing ones", () => {
    const progress = collectionProgress(requireCollection("rarity_1"), CATALOG, new Map([["Карась", 2]]));
    expect(progress.owned).toBe(1);
    expect(progress.total).toBe(2);
    expect(progress.missing).toEqual(["Окунь"]);
    expect(progress.ready).toBe(false);
    expect(progress.available).toBe(true);
  });

  test("is ready when every required fish is owned at least once", () => {
    const progress = collectionProgress(requireCollection("rarity_1"), CATALOG, new Map([["Карась", 1], ["Окунь", 3]]));
    expect(progress.ready).toBe(true);
    expect(progress.missing).toEqual([]);
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
