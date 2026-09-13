import { describe, expect, test } from "bun:test";
import { didCatch } from "../fishing/generator.ts";
import { CASE_RODS, getRod, RODS, SHOP_RODS } from "./rods.ts";

test("rod catalog keeps the shop progression and exclusive case rods", () => {
  expect(SHOP_RODS.map((rod) => rod.id)).toEqual(["basic", "carbon", "titanium", "poseidon"]);
  expect(SHOP_RODS.map((rod) => rod.prerequisite)).toEqual([null, "basic", "carbon", "titanium"]);
  expect(CASE_RODS.map((rod) => rod.id)).toEqual(["reedwhisper", "coppercoil", "frostline", "tidecaller", "amberhook", "stormcast", "deepcurrent", "starforged", "leviathanscale", "aurorafang"]);
  expect(new Set(RODS.map((rod) => rod.id)).size).toBe(RODS.length);
  expect(CASE_RODS.every((rod) => rod.acquisition === "case" && !("price" in rod) && !("recipe" in rod) && !("prerequisite" in rod))).toBeTrue();
  expect(getRod("unknown")).toBeUndefined();
});

test("case rod bonuses and duplicate compensation match the catalog", () => {
  expect(CASE_RODS.map(({ catchBonusPoints, rarityStepBonus, duplicateCompensation }) => [catchBonusPoints, rarityStepBonus, duplicateCompensation])).toEqual([
    [5, 0.05, 750], [7, 0.08, 900], [10, 0.12, 1_500], [12, 0.16, 1_900], [15, 0.22, 3_000],
    [18, 0.28, 4_000], [21, 0.36, 6_500], [24, 0.45, 8_500], [27, 0.58, 15_000], [30, 0.72, 30_000],
  ]);
  expect(CASE_RODS.map((rod) => rod.specialEffect)).toEqual([
    { kind: "modifier_chance", bonusPoints: 3 }, { kind: "rarity_chance", point: 1, chance: 6 }, { kind: "rarity_chance", point: 2, chance: 8 }, { kind: "modifier_chance", bonusPoints: 6 }, { kind: "rarity_chance", point: 3, chance: 10 },
    { kind: "modifier_chance", bonusPoints: 10 }, { kind: "rarity_chance", point: 4, chance: 12 }, { kind: "modifier_chance", bonusPoints: 15 }, { kind: "rarity_chance", point: 5, chance: 15 }, { kind: "rarity_chance", point: 6, chance: 20 },
  ]);
});

describe("rod catch bonuses", () => {
  test("apply percentage points with a 100% cap", () => {
    for (const rod of RODS) {
      const threshold = Math.min(100, 50 + rod.catchBonusPoints);
      expect(didCatch(threshold, () => threshold / 100 - 0.000_001)).toBeTrue();
      expect(didCatch(threshold, () => (threshold + 0.000_001) / 100)).toBeFalse();
    }
    expect(didCatch(Math.min(100, 99 + getRod("aurorafang")!.catchBonusPoints), () => 0.999_999)).toBeTrue();
  });
});
