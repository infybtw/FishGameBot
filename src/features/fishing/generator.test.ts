import { afterEach, describe, expect, jest, spyOn, test } from "bun:test";
import {
  boostedCatch,
  didCatch,
  fakeFishCatch,
  generateCatch,
  generatePrice,
  generateSize,
  generateWeight,
  pickTemplate,
  rollModifier,
  rollPoint,
  tryCatch,
} from "./generator.ts";
import { formatRemaining } from "./cooldown.ts";
import { CHANCE_UP_RARITY_WEIGHTS, RARITY_WEIGHTS, type Catalog } from "./catalog.ts";
import { FISH_MODIFIERS } from "./modifiers.ts";
import { NET_RARITY_WEIGHTS } from "../nets/net.ts";

function mockRandom(values: readonly number[]): void {
  let index = 0;
  spyOn(Math, "random").mockImplementation(() => {
    const value = values[index++];
    if (value === undefined) throw new Error("Test did not provide enough random values");
    return value;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

test("rarity weights match the target catch distribution", () => {
  expect(RARITY_WEIGHTS).toEqual({
    1: 72,
    2: 20,
    3: 6,
    4: 1.5,
    5: 0.4,
    6: 0.1,
  });
  expect(Object.values(RARITY_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBe(100);
});

describe("didCatch", () => {
  test("uses an exclusive percentage boundary", () => {
    expect(didCatch(0, () => 0)).toBeFalse();
    expect(didCatch(50, () => 0.499_999)).toBeTrue();
    expect(didCatch(50, () => 0.5)).toBeFalse();
    expect(didCatch(100, () => 0.999_999)).toBeTrue();
  });
});

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

test("rollPoint respects rarity-weight boundaries", () => {
  const catalog: Catalog = [
    [{ name: "Окунь", rarity: "Обычный", point: 1 }],
    [],
    [{ name: "Сом", rarity: "Эпический", point: 3 }],
  ];
  mockRandom([0, 0.9999999999999999]);

  expect(rollPoint(catalog)).toBe(1);
  expect(rollPoint(catalog)).toBe(3);
});

test("rollPoint rejects an empty catalog", () => {
  expect(() => rollPoint([])).toThrow("Cannot roll a rarity point: fish catalog is empty");
});

describe("pickTemplate", () => {
  const catalog: Catalog = [[
    { name: "Окунь", rarity: "Обычный", point: 1 },
    { name: "Карась", rarity: "Обычный", point: 1 },
  ]];

  test("can select the first and last template", () => {
    mockRandom([0, 0.9999999999999999]);

    expect(pickTemplate(catalog, 1).name).toBe("Окунь");
    expect(pickTemplate(catalog, 1).name).toBe("Карась");
  });

  test("rejects a missing rarity group", () => {
    expect(() => pickTemplate(catalog, 2)).toThrow("No fish templates for rarity point 2");
  });
});

describe("tryCatch", () => {
  const catalog: Catalog = [[{ name: "Окунь", rarity: "Обычный", point: 1 }]];

  test("returns null when the catch chance is missed", () => {
    mockRandom([0.9999999999999999]);

    expect(tryCatch(catalog, "Ира", 50, 0)).toBeNull();
  });

  test("generates a complete catch when the chance succeeds", () => {
    mockRandom([0, 0, 0, 0.5, 0.25, 0.5, 0.5, 0.25, 0.5]);

    expect(tryCatch(catalog, "Ира", 100, 0)).toEqual({
      name: "Окунь",
      rarity: "Обычный",
      point: 1,
      sizeCm: 15.36,
      weightG: 289.91,
      price: 214.5,
      modifier: null,
      catcherFirstName: "Ира",
    });
  });
});

describe("rod-adjusted rarity rolls", () => {
  const catalog: Catalog = [
    [{ name: "1", rarity: "1", point: 1 }],
    [{ name: "2", rarity: "2", point: 2 }],
    [{ name: "3", rarity: "3", point: 3 }],
    [{ name: "4", rarity: "4", point: 4 }],
  ];

  test("applies the exact step multiplier and normalizes it during the roll", () => {
    const rawWeights = [1, 2, 3, 4].map((point) => RARITY_WEIGHTS[point]! * (1 + 0.5 * (point - 1)));
    expect(rawWeights).toEqual([72, 30, 12, 3.75]);
    expect(rollPoint(catalog, 0, () => 0.915)).toBe(2);
    expect(rollPoint(catalog, 0.1, () => 0.915)).toBe(3);
    expect(rollPoint([catalog[0]!, [], catalog[2]!], 0.5, () => 0.99)).toBe(3);
  });
});

test("formatRemaining(3725) === '1часов 2минут 5секунд'", () => {
  expect(formatRemaining(3725)).toBe("1часов 2минут 5секунд");
});

test("chance-up rarity weights target the boosted high-tier distribution", () => {
  expect(CHANCE_UP_RARITY_WEIGHTS).toEqual({ 2: 45, 3: 30, 4: 15, 5: 7, 6: 3 });
});

const BOOST_CATALOG: Catalog = [
  [{ name: "Окунь", rarity: "Обычный", point: 1 }],
  [{ name: "Лещ", rarity: "Редкий", point: 2 }],
  [{ name: "Карп", rarity: "Эпический", point: 3 }],
  [{ name: "Сом", rarity: "Легендарный", point: 4 }],
  [{ name: "Акула", rarity: "Мифическая", point: 5 }],
  [{ name: "Кит", rarity: "Радужная", point: 6 }],
];

// Deterministic tail consumed by generateSize's beta sample.
const SIZE_RANDOMS = [0.5, 0.25, 0.5, 0.5, 0.25, 0.5];

describe("rollPoint with chance-up weights", () => {
  test("selects each boosted point on both sides of its weight boundary", () => {
    mockRandom([0, 0.449, 0.451, 0.749, 0.751, 0.899, 0.901, 0.969, 0.971, 0.9999]);

    const rolled: number[] = [];
    for (let i = 0; i < 10; i++) rolled.push(rollPoint(BOOST_CATALOG, 0, Math.random, CHANCE_UP_RARITY_WEIGHTS));
    expect(rolled).toEqual([2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  });

  test("never selects point 1 even when point 1 is the dominant normal group", () => {
    const catalog: Catalog = [
      [{ name: "Окунь", rarity: "Обычный", point: 1 }],
      [{ name: "Лещ", rarity: "Редкий", point: 2 }],
    ];
    mockRandom([0, 0.9999999999999999]);

    expect(rollPoint(catalog, 0, Math.random, CHANCE_UP_RARITY_WEIGHTS)).toBe(2);
    expect(rollPoint(catalog, 0, Math.random, CHANCE_UP_RARITY_WEIGHTS)).toBe(2);
  });

  test("rejects a catalog without rarity 2-6 groups", () => {
    const catalog: Catalog = [[{ name: "Окунь", rarity: "Обычный", point: 1 }]];
    expect(() => rollPoint(catalog, 0, Math.random, CHANCE_UP_RARITY_WEIGHTS)).toThrow(
      "Cannot roll a rarity point: fish catalog is empty",
    );
  });
});

describe("boostedCatch", () => {
  test("builds a complete catch on the rolled boosted point", () => {
    mockRandom([0.5, 0, ...SIZE_RANDOMS]);

    expect(boostedCatch(BOOST_CATALOG, "Ира")).toEqual({
      name: "Карп",
      rarity: "Эпический",
      point: 3,
      sizeCm: 38.93,
      weightG: 4720.01,
      price: 2724,
      modifier: null,
      catcherFirstName: "Ира",
    });
  });

  test("throws when no rarity 2-6 group exists", () => {
    const catalog: Catalog = [[{ name: "Окунь", rarity: "Обычный", point: 1 }]];
    expect(() => boostedCatch(catalog, "Ира")).toThrow("Cannot roll a rarity point: fish catalog is empty");
  });
});

describe("fakeFishCatch", () => {
  const catalog: Catalog = [
    [],
    [],
    [],
    [],
    [{ name: "Акула", rarity: "Мифическая", point: 5 }],
    [{ name: "Кит", rarity: "Радужная", point: 6 }],
  ];

  test("picks either non-empty high-tier group and builds a complete catch", () => {
    mockRandom([0, 0, ...SIZE_RANDOMS]);

    expect(fakeFishCatch(catalog, "Ира")).toEqual({
      name: "Акула",
      rarity: "Мифическая",
      point: 5,
      sizeCm: 62.5,
      weightG: 19531.25,
      price: 25414.06,
      modifier: null,
      catcherFirstName: "Ира",
    });

    mockRandom([0.9, 0, ...SIZE_RANDOMS]);
    expect(fakeFishCatch(catalog, "Ира").name).toBe("Кит");
  });

  test("selects the only available high-tier group", () => {
    const only6: Catalog = [
      [],
      [],
      [],
      [],
      [],
      [{ name: "Кит", rarity: "Радужная", point: 6 }],
    ];
    mockRandom([0, 0, ...SIZE_RANDOMS]);

    expect(fakeFishCatch(only6, "Ира").point).toBe(6);
  });

  test("throws when neither point 5 nor point 6 has templates", () => {
    const catalog: Catalog = [[{ name: "Окунь", rarity: "Обычный", point: 1 }]];
    expect(() => fakeFishCatch(catalog, "Ира")).toThrow("No fish templates for rarity point 5 or 6");
  });
});

describe("net rarity weights", () => {
  test("sum to 100 and favor common fish below every ordinary high-tier chance", () => {
    expect(NET_RARITY_WEIGHTS).toEqual({ 1: 85, 2: 12, 3: 2, 4: 0.7, 5: 0.25, 6: 0.05 });
    expect(Object.values(NET_RARITY_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBe(100);
    expect(NET_RARITY_WEIGHTS[1]).toBeGreaterThan(RARITY_WEIGHTS[1]!);
    for (const point of [2, 3, 4, 5, 6]) {
      expect(NET_RARITY_WEIGHTS[point]).toBeLessThan(RARITY_WEIGHTS[point]!);
    }
  });

  test("rollPoint follows net-weight boundaries while ignoring empty catalog groups", () => {
    // Point 4 has no templates, so its 0.7 weight is excluded and the
    // remaining weights re-normalize: cumulative thresholds 85, 97, 99,
    // 99.25, 99.3 over a total of 99.3.
    const catalog: Catalog = [
      [{ name: "Окунь", rarity: "Обычный", point: 1 }],
      [{ name: "Лещ", rarity: "Редкий", point: 2 }],
      [{ name: "Карп", rarity: "Эпический", point: 3 }],
      [],
      [{ name: "Акула", rarity: "Мифическая", point: 5 }],
      [{ name: "Кит", rarity: "Радужная", point: 6 }],
    ];
    mockRandom([0, 0.855, 0.856, 0.976, 0.977, 0.997, 0.9999, 0.999_999]);

    const rolled: number[] = [];
    for (let i = 0; i < 8; i++) rolled.push(rollPoint(catalog, 0, Math.random, NET_RARITY_WEIGHTS));
    expect(rolled).toEqual([1, 1, 2, 2, 3, 5, 6, 6]);
  });
});

describe("rollModifier", () => {
  test("modifier weights sum to 100 so every catalog entry stays reachable", () => {
    expect(FISH_MODIFIERS.reduce((sum, modifier) => sum + modifier.weight, 0)).toBe(100);
    // A roll just below each band's midpoint must select exactly that modifier.
    const midBandRandoms = [0.18, 0.5, 0.7, 0.82, 0.89, 0.94, 0.97, 0.99];
    for (const [i, modifier] of FISH_MODIFIERS.entries()) {
      expect(rollModifier(100, () => midBandRandoms[i]! - 0.001)).toBe(modifier);
    }
  });

  test("0% never draws and never consumes randomness", () => {
    mockRandom([]);
    expect(rollModifier(0)).toBeNull();
  });

  test("applies the drop chance as an exclusive percentage band", () => {
    expect(rollModifier(12, () => 0.119)).toBe(FISH_MODIFIERS[0]!);
    expect(rollModifier(12, () => 0.129)).toBeNull();
    expect(rollModifier(100, () => 0.999_999)).toBe(FISH_MODIFIERS[FISH_MODIFIERS.length - 1]!);
  });

  test("each weight band picks exactly its modifier on both sides of the boundary", () => {
    const bands = [37, 62, 77, 86, 92, 96, 98.5, 100];
    for (const [i, modifier] of FISH_MODIFIERS.entries()) {
      const lower = i === 0 ? 0 : bands[i - 1]!;
      const inside = (lower + bands[i]!) / 200; // midpoint fraction of the band
      const justBelow = (bands[i]! - 0.001) / 100;
      const justAbove = (bands[i]! + 0.001) / 100;
      expect(rollModifier(100, () => inside)).toBe(modifier);
      expect(rollModifier(100, () => justBelow)).toBe(modifier);
      if (i + 1 < FISH_MODIFIERS.length) {
        expect(rollModifier(100, () => justAbove)).toBe(FISH_MODIFIERS[i + 1]!);
      }
    }
  });
});

describe("generateCatch with a modifier", () => {
  const catalog: Catalog = [[{ name: "Окунь", rarity: "Обычный", point: 1 }]];

  test("scales size first, then recomputes weight and price from it", () => {
    const golden = FISH_MODIFIERS.find((modifier) => modifier.id === "golden")!;
    // Template pick, six beta draws sizing the base fish at 15.36, then the
    // modifier roll wins (0 < 100) and lands on golden (62 is inside the
    // 37-62 weight band).
    mockRandom([0, ...SIZE_RANDOMS, 0, 0.62]);

    expect(generateCatch(catalog, 1, "Ира", 100)).toEqual({
      name: "Окунь",
      rarity: "Обычный",
      point: 1,
      sizeCm: 17.66,
      weightG: 440.62,
      price: 355.25,
      modifier: golden,
      catcherFirstName: "Ира",
    });
  });

  test("keeps the unmodified formulas when the modifier roll is lost", () => {
    mockRandom([0, ...SIZE_RANDOMS, 0.999_999]);

    expect(generateCatch(catalog, 1, "Ира", 12)).toEqual({
      name: "Окунь",
      rarity: "Обычный",
      point: 1,
      sizeCm: 15.36,
      weightG: 289.91,
      price: 214.5,
      modifier: null,
      catcherFirstName: "Ира",
    });
  });
});
