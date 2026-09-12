import { describe, expect, test } from "bun:test";
import { RARITY_WEIGHTS, type Catalog } from "../fishing/catalog.ts";
import { didCatch, rollPoint } from "../fishing/generator.ts";
import { RODS, type RodDefinition } from "./rods.ts";

const ATTEMPTS = 1_000_000;
const BASE_SUCCESS_CHANCE = 95;
const RARITY_CATALOG: Catalog = [1, 2, 3, 4, 5, 6].map((point) => [
  { name: String(point), rarity: String(point), point },
]);

// A seeded generator makes the million-roll experiment reproducible.
function randomFromSeed(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

function simulateRod(rod: RodDefinition): { catches: number; rarityCounts: number[] } {
  const successChance = Math.min(100, BASE_SUCCESS_CHANCE + rod.catchBonusPoints);
  const random = randomFromSeed(0xF15C); // Intentional shared seed for a fair comparison.
  const rarityCounts = [0, 0, 0, 0, 0, 0];
  let catches = 0;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (!didCatch(successChance, random)) continue;
    catches++;
    rarityCounts[rollPoint(RARITY_CATALOG, rod.rarityStepBonus, random) - 1]!++;
  }

  return { catches, rarityCounts };
}

describe("rod catch and rarity distribution over one million attempts", () => {
  for (const rod of RODS) {
    test(`${rod.id} at a 95% base chance`, () => {
      const successChance = Math.min(100, BASE_SUCCESS_CHANCE + rod.catchBonusPoints);
      const { catches, rarityCounts } = simulateRod(rod);

      if (successChance === 100) {
        expect(catches).toBe(ATTEMPTS);
      } else {
        expect(catches / ATTEMPTS).toBeCloseTo(successChance / 100, 2);
      }

      expect(rarityCounts.reduce((sum, count) => sum + count, 0)).toBe(catches);
      const adjustedWeights = Object.entries(RARITY_WEIGHTS).map(([point, weight]) => weight * (1 + rod.rarityStepBonus * (Number(point) - 1)));
      const expectedCommonShare = adjustedWeights[0]! / adjustedWeights.reduce((sum, weight) => sum + weight, 0);
      expect(rarityCounts[0]! / catches).toBeCloseTo(expectedCommonShare, 2);
    });
  }
});
