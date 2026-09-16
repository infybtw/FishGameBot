import { expect, test } from "bun:test";
import type { InventoryPage } from "../../db/index.ts";
import { EMPTY_COLLECTION_BUFFS } from "../collections/catalog.ts";
import { inventoryCard, profileCard } from "./messages.ts";
import { getRod } from "./rods.ts";

test("inventoryCard prefixes modified fish with the modifier label", () => {
  const inventory: InventoryPage = {
    page: 1,
    totalCount: 2,
    totalValue: 455.25,
    fishes: [
      {
        id: 7,
        name: "Окунь",
        rarity: "Обычный",
        point: 1,
        sizeCm: 17.66,
        weightG: 440.62,
        price: 355.25,
        fishModifierId: "golden",
        fishModifierName: "Золотая",
        fishModifierRarity: "Редкий",
      },
      {
        id: 8,
        name: "Лещ",
        rarity: "Редкий",
        point: 2,
        sizeCm: 27.14,
        weightG: 1599.26,
        price: 100,
        fishModifierId: null,
        fishModifierName: null,
        fishModifierRarity: null,
      },
    ],
  };

  const text = inventoryCard(inventory);
  expect(text).toContain("#7 <b>Золотая Окунь</b>");
  expect(text).toContain("#8 <b>Лещ</b>");
  expect(text).not.toContain("Золотая Лещ");
});

test("profileCard folds collection bonuses into the displayed stats", () => {
  const rod = getRod("basic")!;
  const withoutBuffs = profileCard(0, rod, 50, 0, 0, EMPTY_COLLECTION_BUFFS);
  expect(withoutBuffs).toContain("<b>Шанс поймать:</b> 50% → 50%");
  expect(withoutBuffs).not.toContain("Бонусы коллекций");

  const withBuffs = profileCard(0, rod, 50, 0, 0, {
    catchChancePoints: 5,
    rarityStepBonus: 0.03,
    modifierChancePoints: 4,
    priceMultiplier: 1.2,
  });
  expect(withBuffs).toContain("<b>Шанс поймать:</b> 50% → 55%");
  expect(withBuffs).toContain("<b>Бонус редкости:</b> +3% за шаг");
  expect(withBuffs).toContain("<b>Бонусы коллекций:</b> +5 п.п. к поимке, +3% к редкости, +4 п.п. к модификатору, ×1.2 к цене");
});
