import { describe, expect, test } from "bun:test";
import { rollBalanceMultiplier, rollCurse } from "./curses.ts";

function countingRandom(values: readonly number[]): { random: () => number; callCount: () => number } {
  let index = 0;
  let calls = 0;
  return {
    random: () => {
      calls++;
      const value = values[index++];
      if (value === undefined) throw new Error("Test did not provide enough random values");
      return value;
    },
    callCount: () => calls,
  };
}

describe("rollCurse", () => {
  test("zero chance returns null without consuming randomness", () => {
    const counted = countingRandom([]);
    expect(rollCurse(0, counted.random)).toBeNull();
    expect(counted.callCount()).toBe(0);
  });

  test("one percentage draw decides the drop at the chance boundary", () => {
    expect(rollCurse(20, () => 0.19)).not.toBeNull();
    expect(rollCurse(20, () => 0.2)).toBeNull();
    expect(rollCurse(100, () => 0)).not.toBeNull();
  });

  test("kind bands select the exact curse with its Russian name at every boundary", () => {
    expect(rollCurse(100, () => 0)).toEqual({ kind: "heavy_net", name: "Проклятие тяжёлой сети" });
    expect(rollCurse(100, () => 0.31)).toEqual({ kind: "heavy_net", name: "Проклятие тяжёлой сети" });
    expect(rollCurse(100, () => 0.32)).toEqual({ kind: "second_cast", name: "Проклятие второго заброса" });
    expect(rollCurse(100, () => 0.63)).toEqual({ kind: "second_cast", name: "Проклятие второго заброса" });
    expect(rollCurse(100, () => 0.64)).toEqual({ kind: "storm_tide", name: "Проклятие штормового прилива" });
    expect(rollCurse(100, () => 0.68)).toEqual({ kind: "storm_tide", name: "Проклятие штормового прилива" });
    expect(rollCurse(100, () => 0.69)).toEqual({ kind: "golden_scales", name: "Проклятие золотой чешуи" });
    expect(rollCurse(100, () => 0.99)).toEqual({ kind: "golden_scales", name: "Проклятие золотой чешуи" });
  });

  test("only the 64-68 band is the chat-wide reset", () => {
    for (const roll of [0, 0.31, 0.32, 0.63, 0.69, 0.99]) {
      expect(rollCurse(100, () => roll)?.kind).not.toBe("storm_tide");
    }
    for (const roll of [0.64, 0.66, 0.68]) {
      expect(rollCurse(100, () => roll)?.kind).toBe("storm_tide");
    }
  });
});

describe("rollBalanceMultiplier", () => {
  test("the lowest draw is exactly 0.8 and the highest announces 1.2", () => {
    expect(rollBalanceMultiplier(() => 0)).toBe(0.8);
    expect(rollBalanceMultiplier(() => 0.999)).toBeCloseTo(1.2, 12);
    expect(rollBalanceMultiplier(() => 0.999) > 1.19).toBe(true);
  });

  test("the 41 draws map onto the exact two-decimal steps from 0.80 to 1.20", () => {
    for (let step = 0; step < 41; step++) {
      expect(rollBalanceMultiplier(() => (step + 0.5) / 41)).toBe(0.8 + step / 100);
    }
  });
});
