export type RodId = "basic" | "carbon" | "titanium" | "poseidon";

export type RodRecipeItem = { point: number; count: number };
export type RodDefinition = {
  id: RodId;
  name: string;
  prerequisite: RodId | null;
  price: number;
  recipe: readonly RodRecipeItem[];
  catchBonusPoints: number;
  rarityStepBonus: number;
};

export const RODS: readonly RodDefinition[] = [
  {
    id: "basic",
    name: "🎋 Бамбуковая удочка",
    prerequisite: null,
    price: 0,
    recipe: [],
    catchBonusPoints: 0,
    rarityStepBonus: 0,
  },
  {
    id: "carbon",
    name: "🎣 Карбоновая удочка",
    prerequisite: "basic",
    price: 2_500,
    recipe: [
      { point: 1, count: 4 },
      { point: 2, count: 2 },
    ],
    catchBonusPoints: 8,
    rarityStepBonus: 0.1,
  },
  {
    id: "titanium",
    name: "⚙️ Титановая удочка",
    prerequisite: "carbon",
    price: 12_000,
    recipe: [
      { point: 2, count: 4 },
      { point: 3, count: 2 },
    ],
    catchBonusPoints: 16,
    rarityStepBonus: 0.25,
  },
  {
    id: "poseidon",
    name: "🔱 Трезубец Посейдона",
    prerequisite: "titanium",
    price: 40_000,
    recipe: [
      { point: 3, count: 3 },
      { point: 4, count: 1 },
    ],
    catchBonusPoints: 25,
    rarityStepBonus: 0.5,
  },
] as const;

const rodsById: Readonly<Record<RodId, RodDefinition>> = {
  basic: RODS[0]!,
  carbon: RODS[1]!,
  titanium: RODS[2]!,
  poseidon: RODS[3]!,
};

export function getRod(id: string): RodDefinition | undefined {
  return rodsById[id as RodId];
}
