import { describe, expect, test } from "bun:test";
import { CASE_RODS } from "../upgrades/rods.ts";
import { ROD_CASES, rollCaseRod } from "./catalog.ts";

test("case weights total exactly 100 percent", () => {
  for (const case_ of ROD_CASES) expect(Object.values(case_.weights).reduce((sum, weight) => sum + weight, 0)).toBe(100);
});

describe("rollCaseRod", () => {
  test("uses rarity boundaries and then chooses within the tier", () => {
    expect(rollCaseRod("tackle_case", () => 0).rarity).toBe("Обычная");
    expect(rollCaseRod("tackle_case", () => 0.75).rarity).toBe("Необычная");
    expect(rollCaseRod("tackle_case", () => 0.95).rarity).toBe("Редкая");
    expect(rollCaseRod("tackle_case", () => 0.99).rarity).toBe("Эпическая");
    expect(rollCaseRod("tackle_case", () => 0.9985).rarity).toBe("Легендарная");
    expect(rollCaseRod("tackle_case", () => 0.9999).rarity).toBe("Мифическая");
  });

  test("returns only a case rod from the rolled tier and rejects invalid input", () => {
    const rod = rollCaseRod("deepwater_case", (() => { let call = 0; return () => ++call === 1 ? 0.65 : 0; })());
    expect(rod.rarity).toBe("Редкая");
    expect(CASE_RODS).toContain(rod);
    expect(() => rollCaseRod("unknown" as never, () => 0)).toThrow("Unknown rod case");
    expect(() => rollCaseRod("tackle_case", () => 1)).toThrow("[0, 1)");
  });
});
