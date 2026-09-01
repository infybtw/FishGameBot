import { describe, expect, test } from "bun:test";
import { generatePrice, generateSize, generateWeight, rollPoint } from "./generator.ts";
import { formatRemaining } from "./cooldown.ts";
import type { Catalog } from "./catalog.ts";

describe("generateSize", () => {
  for (const point of [1, 2, 3, 4, 5, 6]) {
    test(`point ${point} stays within [min, max]`, () => {
      const min = 10 * point;
      const max = 40 + 20 * (point - 1);
      for (let i = 0; i < 200; i++) {
        const size = generateSize(point);
        expect(size).toBeGreaterThanOrEqual(min);
        expect(size).toBeLessThanOrEqual(max);
      }
    });
  }
});

test("generateWeight(40) === 5120", () => {
  expect(generateWeight(40)).toBe(5120);
});

test("generatePrice(2, 1000) === 600", () => {
  expect(generatePrice(2, 1000)).toBe(600);
});

describe("rollPoint", () => {
  test("returns only present points across 500 rolls", () => {
    const catalog: Catalog = [
      [{ name: "Окунь", rarity: "Обычный", point: 1 }],
      [],
      [
        { name: "Сом", rarity: "Эпический", point: 3 },
        { name: "Осётр", rarity: "Эпический", point: 3 },
      ],
    ];
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      seen.add(rollPoint(catalog));
    }
    expect([...seen].sort()).toEqual([1, 3]);
  });
});

test("formatRemaining(3725) === '1часов 2минут 5секунд'", () => {
  expect(formatRemaining(3725)).toBe("1часов 2минут 5секунд");
});
