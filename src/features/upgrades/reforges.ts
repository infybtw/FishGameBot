export type ReforgeEffect = {
  id: string;
  name: string;
  description: string;
  priceMultiplier?: number;
  rarityStepBonus?: number;
  modifierChancePoints?: number;
};

type ReforgeTier = readonly [ReforgeEffect, ReforgeEffect, ReforgeEffect];

const tiers: Readonly<Record<number, ReforgeTier>> = {
  1: [
    { id: "steady", name: "Бережливая", description: "+5% к стоимости улова", priceMultiplier: 1.05 },
    { id: "lucky", name: "Удачливая", description: "+2% к шансу редкости за шаг", rarityStepBonus: 0.02 },
    { id: "sparkling", name: "Искристая", description: "+1 п.п. к шансу модификатора", modifierChancePoints: 1 },
  ],
  2: [
    { id: "keen", name: "Доходная", description: "+10% к стоимости улова", priceMultiplier: 1.1 },
    { id: "fortunate", name: "Везучая", description: "+4% к шансу редкости за шаг", rarityStepBonus: 0.04 },
    { id: "glimmering", name: "Мерцающая", description: "+2 п.п. к шансу модификатора", modifierChancePoints: 2 },
  ],
  3: [
    { id: "precise", name: "Ценная", description: "+15% к стоимости улова", priceMultiplier: 1.15 },
    { id: "prosperous", name: "Благодатная", description: "+6% к шансу редкости за шаг", rarityStepBonus: 0.06 },
    { id: "charged", name: "Заряженная", description: "+3 п.п. к шансу модификатора", modifierChancePoints: 3 },
  ],
  4: [
    { id: "masterful", name: "Сокровенная", description: "+20% к стоимости улова", priceMultiplier: 1.2 },
    { id: "favored", name: "Благословенная", description: "+8% к шансу редкости за шаг", rarityStepBonus: 0.08 },
    { id: "radiant", name: "Сияющая", description: "+4 п.п. к шансу модификатора", modifierChancePoints: 4 },
  ],
  5: [
    { id: "flawless", name: "Роскошная", description: "+25% к стоимости улова", priceMultiplier: 1.25 },
    { id: "destined", name: "Судьбоносная", description: "+10% к шансу редкости за шаг", rarityStepBonus: 0.1 },
    { id: "prismatic", name: "Призматическая", description: "+5 п.п. к шансу модификатора", modifierChancePoints: 5 },
  ],
  6: [
    { id: "divine", name: "Несметная", description: "+30% к стоимости улова", priceMultiplier: 1.3 },
    { id: "celestial", name: "Небесная", description: "+12% к шансу редкости за шаг", rarityStepBonus: 0.12 },
    { id: "astral", name: "Астральная", description: "+6 п.п. к шансу модификатора", modifierChancePoints: 6 },
  ],
};

const byId = new Map(Object.values(tiers).flat().map((reforge) => [reforge.id, reforge]));

export function reforgeOptions(point: number): ReforgeTier | undefined { return tiers[point]; }
export function getReforge(id: string | null): ReforgeEffect | undefined { return id === null ? undefined : byId.get(id); }
export function rollReforge(point: number, random: () => number = Math.random): ReforgeEffect | undefined {
  const options = reforgeOptions(point);
  return options?.[Math.min(options.length - 1, Math.floor(random() * options.length))];
}
