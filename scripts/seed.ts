import { createRepo, createSql, migrateSchema } from "../src/db/index.ts";

const SEED: Array<[name: string, rarity: string, point: number]> = [
  ["Окунь", "Обычный", 1],
  ["Карась", "Обычный", 1],
  ["Щука", "Редкий", 2],
  ["Судак", "Редкий", 2],
  ["Сом", "Эпический", 3],
  ["Осётр", "Эпический", 3],
  ["Белуга", "Легендарный", 4],
  ["Угорь", "Легендарный", 4],
  ["Золотая рыбка", "Мифический", 5],
  ["Кракен", "Мифический", 5],
  ["Радужная форель", "Радужный", 6],
  ["Призрачный лещ", "Радужный", 6],
];

const databaseUrl = process.env.DATABASE_URL?.trim() || "postgres://localhost:5432/fishbot";
const sql = createSql(databaseUrl);
await migrateSchema(sql);
const repo = createRepo(sql);

const existing = await repo.listTemplates();
if (existing.length > 0) {
  console.log(`Fish list already contains ${existing.length} templates, nothing to seed`);
  await sql.end();
  process.exit(0);
}

for (const [name, rarity, point] of SEED) {
  await repo.insertTemplate(name, rarity, point);
}
console.log(`Inserted ${SEED.length} fish templates`);
await sql.end();
