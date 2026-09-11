import { describe, expect, test } from "bun:test";
import { FISH_UPGRADE_CHANCES, didUpgradeSucceed, upgradeChanceFor, upgradeChanceSummary } from "./chances.ts";

describe("fish upgrade chances", () => {
  test("exposes the recommended scale for rarity points 1-5", () => {
    expect(FISH_UPGRADE_CHANCES).toEqual({ 1: 80, 2: 60, 3: 40, 4: 20, 5: 10 });
    expect(upgradeChanceFor(1)).toBe(80);
    expect(upgradeChanceFor(2)).toBe(60);
    expect(upgradeChanceFor(3)).toBe(40);
    expect(upgradeChanceFor(4)).toBe(20);
    expect(upgradeChanceFor(5)).toBe(10);
  });

  test("treats point 6 and out-of-range points as not upgradeable", () => {
    expect(upgradeChanceFor(6)).toBeNull();
    expect(upgradeChanceFor(7)).toBeNull();
    expect(upgradeChanceFor(0)).toBeNull();
    expect(upgradeChanceFor(-1)).toBeNull();
    expect(upgradeChanceFor(1.5)).toBeNull();
  });

  test("roll succeeds strictly below the chance and fails at the boundary", () => {
    expect(didUpgradeSucceed(80, () => 0)).toBeTrue();
    expect(didUpgradeSucceed(80, () => 0.7999)).toBeTrue();
    expect(didUpgradeSucceed(80, () => 0.8)).toBeFalse();
    expect(didUpgradeSucceed(80, () => 0.9999)).toBeFalse();
    expect(didUpgradeSucceed(10, () => 0.0999)).toBeTrue();
    expect(didUpgradeSucceed(10, () => 0.1)).toBeFalse();
    expect(didUpgradeSucceed(100, () => 0.999999)).toBeTrue();
  });

  test("summary renders one entry per scale step", () => {
    expect(upgradeChanceSummary()).toBe("1→2: 80%, 2→3: 60%, 3→4: 40%, 4→5: 20%, 5→6: 10%");
  });
});
