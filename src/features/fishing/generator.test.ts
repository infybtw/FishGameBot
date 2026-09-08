import { afterEach, describe, expect, jest, spyOn, test } from "bun:test";
import {
  boostedCatch,
  fakeFishCatch,
  generatePrice,
  generateSize,
  generateWeight,
  pickTemplate,
  rollPoint,
  tryCatch,
} from "./generator.ts";
import { formatRemaining } from "./cooldown.ts";
import { CHANCE_UP_RARITY_WEIGHTS, RARITY_WEIGHTS, type Catalog } from "./catalog.ts";

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
  const config = {
    botToken: "test-token",
    adminUserId: 1,
    catchSuccessChance: 100,
    catchDelaySeconds: 0,
    databaseUrl: "postgres://localhost:5432/fishbot",
  };

  test("returns null when the catch chance is missed", () => {
    mockRandom([0.9999999999999999]);

    expect(tryCatch(catalog, { ...config, catchSuccessChance: 50 }, "Ира")).toBeNull();
  });

  test("generates a complete catch when the chance succeeds", () => {
    mockRandom([0, 0, 0, 0.5, 0.25, 0.5, 0.5, 0.25, 0.5]);

    expect(tryCatch(catalog, config, "Ира")).toEqual({
      name: "Окунь",
      rarity: "Обычный",
      point: 1,
      sizeCm: 15.36,
      weightG: 289.91,
      price: 214.5,
      catcherFirstName: "Ира",
    });
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
    for (let i = 0; i < 10; i++) rolled.push(rollPoint(BOOST_CATALOG, CHANCE_UP_RARITY_WEIGHTS));
    expect(rolled).toEqual([2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  });

  test("never selects point 1 even when point 1 is the dominant normal group", () => {
    const catalog: Catalog = [
      [{ name: "Окунь", rarity: "Обычный", point: 1 }],
      [{ name: "Лещ", rarity: "Редкий", point: 2 }],
    ];
    mockRandom([0, 0.9999999999999999]);

    expect(rollPoint(catalog, CHANCE_UP_RARITY_WEIGHTS)).toBe(2);
    expect(rollPoint(catalog, CHANCE_UP_RARITY_WEIGHTS)).toBe(2);
  });

  test("rejects a catalog without rarity 2-6 groups", () => {
    const catalog: Catalog = [[{ name: "Окунь", rarity: "Обычный", point: 1 }]];
    expect(() => rollPoint(catalog, CHANCE_UP_RARITY_WEIGHTS)).toThrow(
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
