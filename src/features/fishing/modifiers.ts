/**
 * Self-contained fish modifier catalog: an optional second property on a
 * caught fish, independent of its base rarity. No database or Telegram
 * dependency; the catalog stays in code so balance edits ship with deploys.
 */
export type FishModifier = {
  id: string;
  name: string;
  rarity: string;
  /** Selection weight among already modified catches; values sum to 100. */
  weight: number;
  sizeMultiplier: number;
  priceMultiplier: number;
};

export const FISH_MODIFIERS: readonly FishModifier[] = [
  { id: "well_fed", name: "Упитанная", rarity: "Обычный", weight: 37, sizeMultiplier: 1.05, priceMultiplier: 1.1 },
  { id: "silver", name: "Серебряная", rarity: "Необычный", weight: 25, sizeMultiplier: 1.1, priceMultiplier: 1.25 },
  { id: "golden", name: "Золотая", rarity: "Редкий", weight: 15, sizeMultiplier: 1.15, priceMultiplier: 1.6 },
  { id: "electric", name: "Электрическая", rarity: "Редкий", weight: 9, sizeMultiplier: 1.18, priceMultiplier: 1.85 },
  { id: "rainbow", name: "Радужная", rarity: "Эпический", weight: 6, sizeMultiplier: 1.25, priceMultiplier: 2.5 },
  { id: "moonlit", name: "Лунная", rarity: "Эпический", weight: 4, sizeMultiplier: 1.3, priceMultiplier: 3.25 },
  { id: "crystalline", name: "Кристальная", rarity: "Легендарный", weight: 2.5, sizeMultiplier: 1.4, priceMultiplier: 4.5 },
  { id: "abyssal", name: "Бездна", rarity: "Мифический", weight: 1.5, sizeMultiplier: 1.55, priceMultiplier: 7 },
];

/** Short list label: the modifier name goes in front of the fish name. */
export function modifierLabel(name: string, modifierName: string | null): string {
  return modifierName === null ? name : `${modifierName} ${name}`;
}
