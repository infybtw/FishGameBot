import { CASE_RODS, type CaseRodDefinition, type RodRarity } from "../upgrades/rods.ts";

export type RodCaseId = "tackle_case" | "deepwater_case" | "relic_case";
export type RodCaseDefinition = { id: RodCaseId; name: string; price: number; weights: Readonly<Record<RodRarity, number>> };

export const ROD_CASES: readonly RodCaseDefinition[] = [
  { id: "tackle_case", name: "Ящик снастей", price: 2_500, weights: { "Обычная": 75, "Необычная": 20, "Редкая": 4, "Эпическая": 0.8, "Легендарная": 0.18, "Мифическая": 0.02 } },
  { id: "deepwater_case", name: "Глубоководный кейс", price: 10_000, weights: { "Обычная": 0, "Необычная": 65, "Редкая": 28, "Эпическая": 6, "Легендарная": 0.9, "Мифическая": 0.1 } },
  { id: "relic_case", name: "Реликварий рыбака", price: 35_000, weights: { "Обычная": 0, "Необычная": 0, "Редкая": 70, "Эпическая": 25, "Легендарная": 4.5, "Мифическая": 0.5 } },
];
const casesById = Object.fromEntries(ROD_CASES.map((case_) => [case_.id, case_])) as Readonly<Record<RodCaseId, RodCaseDefinition>>;
export function getRodCase(id: string): RodCaseDefinition | undefined { return casesById[id as RodCaseId]; }
export function rollCaseRod(caseId: RodCaseId, random: () => number): CaseRodDefinition {
  const case_ = getRodCase(caseId);
  if (case_ === undefined) throw new Error(`Unknown rod case: ${caseId}`);
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("Case random value must be in [0, 1)");
  let cursor = 0;
  let rarity: RodRarity | undefined;
  for (const [name, weight] of Object.entries(case_.weights) as [RodRarity, number][]) { cursor += weight; if (value * 100 < cursor) { rarity = name; break; } }
  const candidates = CASE_RODS.filter((rod) => rod.rarity === rarity);
  if (candidates.length === 0) throw new Error(`Rod case configuration has no rods for rarity ${rarity}`);
  return candidates[Math.floor(random() * candidates.length)]!;
}
