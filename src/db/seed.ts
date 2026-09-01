import type { FishTemplateInsert, Repo } from "./index.ts";

export const DEFAULT_FISH: FishTemplateInsert[] = [
  { name: "Окунь", rarity: "Обычный", point: 1 },
  { name: "Карась", rarity: "Обычный", point: 1 },
  { name: "Щука", rarity: "Редкий", point: 2 },
  { name: "Судак", rarity: "Редкий", point: 2 },
  { name: "Сом", rarity: "Эпический", point: 3 },
  { name: "Осётр", rarity: "Эпический", point: 3 },
  { name: "Белуга", rarity: "Легендарный", point: 4 },
  { name: "Угорь", rarity: "Легендарный", point: 4 },
  { name: "Золотая рыбка", rarity: "Мифический", point: 5 },
  { name: "Кракен", rarity: "Мифический", point: 5 },
  { name: "Радужная форель", rarity: "Радужный", point: 6 },
  { name: "Призрачный лещ", rarity: "Радужный", point: 6 },
];

/**
 * Seeds the default fish list, but only into an empty catalog — a populated
 * or legacy-migrated database is never touched. Returns the inserted count.
 */
export async function seedDefaultFish(repo: Repo): Promise<number> {
  const existing = await repo.listTemplates();
  if (existing.length > 0) return 0;
  for (const template of DEFAULT_FISH) {
    await repo.insertTemplate(template.name, template.rarity, template.point);
  }
  return DEFAULT_FISH.length;
}
