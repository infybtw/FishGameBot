/**
 * Success chance (percent) for upgrading a fish from the given rarity point
 * to `point + 1`. Values are centralized here so rebalancing never touches
 * UI or SQL; point 6 is the ceiling and is never upgradeable.
 */
export const FISH_UPGRADE_CHANCES: Readonly<Record<number, number>> = {
  1: 80,
  2: 60,
  3: 40,
  4: 20,
  5: 10,
};

/** Success chance in percent for `sourcePoint`, or null when it cannot be upgraded. */
export function upgradeChanceFor(sourcePoint: number): number | null {
  const chance = FISH_UPGRADE_CHANCES[sourcePoint];
  return typeof chance === "number" && chance > 0 ? chance : null;
}

/** Pure upgrade roll: succeeds when `random()` lands strictly below the chance. */
export function didUpgradeSucceed(chance: number, random: () => number = Math.random): boolean {
  return random() * 100 < chance;
}

/** Human-readable one-line summary of the whole chance scale. */
export function upgradeChanceSummary(): string {
  return Object.entries(FISH_UPGRADE_CHANCES)
    .map(([point, chance]) => `${point}→${Number(point) + 1}: ${chance}%`)
    .join(", ");
}
