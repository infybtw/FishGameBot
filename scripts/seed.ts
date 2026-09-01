import { createRepo, createSql, migrateSchema } from "../src/db/index.ts";
import { seedDefaultFish } from "../src/db/seed.ts";

const databaseUrl = process.env.DATABASE_URL?.trim() || "postgres://localhost:5432/fishbot";
const sql = createSql(databaseUrl);
await migrateSchema(sql);
const repo = createRepo(sql);

const inserted = await seedDefaultFish(repo);
console.log(
  inserted > 0
    ? `Inserted ${inserted} default fish templates`
    : "Fish list already contains templates, nothing to seed",
);
await sql.end();
