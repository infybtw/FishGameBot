import { afterEach, describe, expect, jest, spyOn, test } from "bun:test";
import { betaSample, gammaSample, randomInt, standardNormal } from "./random.ts";

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

describe("randomInt", () => {
  test("includes both bounds", () => {
    mockRandom([0, 0.9999999999999999]);

    expect(randomInt(3, 7)).toBe(3);
    expect(randomInt(3, 7)).toBe(7);
  });
});

describe("standardNormal", () => {
  test("retries zero Box-Muller inputs", () => {
    mockRandom([0, 0, 0.5, 0.5]);

    expect(standardNormal()).toBeCloseTo(-Math.sqrt(-2 * Math.log(0.5)));
  });
});

describe("gammaSample", () => {
  test("returns the Marsaglia-Tsang sample for shapes at least one", () => {
    mockRandom([0.5, 0.25, 0.5]);

    expect(gammaSample(2)).toBeCloseTo(5 / 3);
  });

  test("uses the boost transformation for shapes below one", () => {
    mockRandom([0.5, 0.25, 0.5, 0.25]);

    expect(gammaSample(0.5)).toBeCloseTo(7 / 96);
  });
});

describe("betaSample", () => {
  test("normalizes the two gamma samples", () => {
    mockRandom([0.5, 0.25, 0.5, 0.5, 0.25, 0.5]);

    expect(betaSample(1, 1)).toBe(0.5);
  });
});
