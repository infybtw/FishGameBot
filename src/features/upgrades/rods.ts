export type RodId =
  | "basic" | "carbon" | "titanium" | "poseidon"
  | "reedwhisper" | "coppercoil" | "frostline" | "tidecaller" | "amberhook"
  | "stormcast" | "deepcurrent" | "starforged" | "leviathanscale" | "aurorafang";

export type RodRarity = "Обычная" | "Необычная" | "Редкая" | "Эпическая" | "Легендарная" | "Мифическая";
export type RodRecipeItem = { point: number; count: number };
type RodBase = { id: RodId; name: string; rarity: RodRarity; catchBonusPoints: number; rarityStepBonus: number };
export type ShopRodDefinition = RodBase & { acquisition: "shop"; prerequisite: RodId | null; price: number; recipe: readonly RodRecipeItem[] };
export type CaseRodDefinition = RodBase & { acquisition: "case"; duplicateCompensation: number };
export type RodDefinition = ShopRodDefinition | CaseRodDefinition;

export const SHOP_RODS: readonly ShopRodDefinition[] = [
  { id: "basic", name: "🎋 Бамбуковая удочка", rarity: "Обычная", acquisition: "shop", prerequisite: null, price: 0, recipe: [], catchBonusPoints: 0, rarityStepBonus: 0 },
  { id: "carbon", name: "🎣 Карбоновая удочка", rarity: "Обычная", acquisition: "shop", prerequisite: "basic", price: 2_500, recipe: [{ point: 1, count: 4 }, { point: 2, count: 2 }], catchBonusPoints: 8, rarityStepBonus: 0.1 },
  { id: "titanium", name: "⚙️ Титановая удочка", rarity: "Редкая", acquisition: "shop", prerequisite: "carbon", price: 12_000, recipe: [{ point: 2, count: 4 }, { point: 3, count: 2 }], catchBonusPoints: 16, rarityStepBonus: 0.25 },
  { id: "poseidon", name: "🔱 Трезубец Посейдона", rarity: "Легендарная", acquisition: "shop", prerequisite: "titanium", price: 40_000, recipe: [{ point: 3, count: 3 }, { point: 4, count: 1 }], catchBonusPoints: 25, rarityStepBonus: 0.5 },
];

export const CASE_RODS: readonly CaseRodDefinition[] = [
  { id: "reedwhisper", name: "Камышовый шёпот", rarity: "Обычная", acquisition: "case", catchBonusPoints: 5, rarityStepBonus: 0.05, duplicateCompensation: 750 },
  { id: "coppercoil", name: "Медная спираль", rarity: "Обычная", acquisition: "case", catchBonusPoints: 7, rarityStepBonus: 0.08, duplicateCompensation: 900 },
  { id: "frostline", name: "Морозная леска", rarity: "Необычная", acquisition: "case", catchBonusPoints: 10, rarityStepBonus: 0.12, duplicateCompensation: 1_500 },
  { id: "tidecaller", name: "Зов прилива", rarity: "Необычная", acquisition: "case", catchBonusPoints: 12, rarityStepBonus: 0.16, duplicateCompensation: 1_900 },
  { id: "amberhook", name: "Янтарный крюк", rarity: "Редкая", acquisition: "case", catchBonusPoints: 15, rarityStepBonus: 0.22, duplicateCompensation: 3_000 },
  { id: "stormcast", name: "Грозовой заброс", rarity: "Редкая", acquisition: "case", catchBonusPoints: 18, rarityStepBonus: 0.28, duplicateCompensation: 4_000 },
  { id: "deepcurrent", name: "Глубинное течение", rarity: "Эпическая", acquisition: "case", catchBonusPoints: 21, rarityStepBonus: 0.36, duplicateCompensation: 6_500 },
  { id: "starforged", name: "Звёздная кузня", rarity: "Эпическая", acquisition: "case", catchBonusPoints: 24, rarityStepBonus: 0.45, duplicateCompensation: 8_500 },
  { id: "leviathanscale", name: "Чешуя Левиафана", rarity: "Легендарная", acquisition: "case", catchBonusPoints: 27, rarityStepBonus: 0.58, duplicateCompensation: 15_000 },
  { id: "aurorafang", name: "Клык Авроры", rarity: "Мифическая", acquisition: "case", catchBonusPoints: 30, rarityStepBonus: 0.72, duplicateCompensation: 30_000 },
];

export const RODS: readonly RodDefinition[] = [...SHOP_RODS, ...CASE_RODS];
const rodsById: Readonly<Record<RodId, RodDefinition>> = Object.fromEntries(RODS.map((rod) => [rod.id, rod])) as Readonly<Record<RodId, RodDefinition>>;
export function getRod(id: string): RodDefinition | undefined { return rodsById[id as RodId]; }
