import { describe, expect, test } from "bun:test";
import { didCatch } from "../fishing/generator.ts";
import { getRod, RODS } from "./rods.ts";

test("rod catalog is the trusted sequential progression", () => {
  expect(RODS).toEqual([
    { id: "basic", name: "🎋 Бамбуковая удочка", prerequisite: null, price: 0, recipe: [], catchBonusPoints: 0, rarityStepBonus: 0 },
    {
      id: "carbon",
      name: "🎣 Карбоновая удочка",
      prerequisite: "basic",
      price: 2_500,
      recipe: [
        { point: 1, count: 4 },
        { point: 2, count: 2 },
      ],
      catchBonusPoints: 8,
      rarityStepBonus: 0.1,
    },
    {
      id: "titanium",
      name: "⚙️ Титановая удочка",
      prerequisite: "carbon",
      price: 12_000,
      recipe: [
        { point: 2, count: 4 },
        { point: 3, count: 2 },
      ],
      catchBonusPoints: 16,
      rarityStepBonus: 0.25,
    },
    {
      id: "poseidon",
      name: "🔱 Трезубец Посейдона",
      prerequisite: "titanium",
      price: 40_000,
      recipe: [
        { point: 3, count: 3 },
        { point: 4, count: 1 },
      ],
      catchBonusPoints: 25,
      rarityStepBonus: 0.5,
    },
  ]);
  expect(getRod("unknown")).toBeUndefined();
});

describe("rod catch bonuses", () => {
  test("apply percentage points with a 100% cap", () => {
    expect(RODS.map((rod) => Math.min(100, 50 + rod.catchBonusPoints))).toEqual([50, 58, 66, 75]);
    for (const rod of RODS) {
      const threshold = Math.min(100, 50 + rod.catchBonusPoints);
      expect(didCatch(threshold, () => threshold / 100 - 0.000_001)).toBeTrue();
      expect(didCatch(threshold, () => (threshold + 0.000_001) / 100)).toBeFalse();
    }
    expect(didCatch(Math.min(100, 99 + getRod("poseidon")!.catchBonusPoints), () => 0.999_999)).toBeTrue();
  });
});
