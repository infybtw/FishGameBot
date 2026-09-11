import { expect, test } from "bun:test";
import type { InventoryPage } from "../../db/index.ts";
import { inventoryCard } from "./messages.ts";

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
