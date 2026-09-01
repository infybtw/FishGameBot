import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createSql, migrateSchema } from "../src/db/index.ts";

const sourceArg = process.argv[2];
if (sourceArg === undefined) {
  console.error("Usage: bun scripts/migrate-legacy.ts <path-to-parser.db>");
  process.exit(1);
}
const sourcePath = resolve(sourceArg);
if (!existsSync(sourcePath)) {
  console.error(`Legacy database not found: ${sourcePath}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL?.trim() || "postgres://localhost:5432/fishbot";
const sql = createSql(databaseUrl);
await migrateSchema(sql);

const legacy = new Database(sourcePath, { readonly: true });

type AnyRow = Record<string, number | string>;

async function copyTable(table: string, read: () => AnyRow[], insert: (row: AnyRow) => Promise<unknown>): Promise<void> {
  const rows = read();
  let copied = 0;
  for (const row of rows) {
    const result = (await insert(row)) as unknown[];
    if (result.length > 0) copied++;
  }
  console.log(`${table}: ${copied} of ${rows.length} rows copied`);
}

const FISHES_SQL = "SELECT fish_id, fish_name, fish_rarity, fish_rarity_point FROM fishes";
const CAUGHT_SQL =
  "SELECT id, username, user_id, fish_name, fish_weight, fish_size, fish_rarity, fish_rarity_point, fish_price, chat_id FROM caught_fishes";
const CATCH_TIME_SQL = "SELECT user_id, chat_id, last_catch_time FROM catch_time";
// Legacy total_fish_prices is intentionally dropped; totals are computed at read time.
const FISHERS_SQL = "SELECT user_id, chat_id, user_first_name, user_balance FROM fishers";

await copyTable(
  "fishes",
  () => legacy.query(FISHES_SQL).all() as AnyRow[],
  (row) =>
    sql`INSERT INTO fishes (fish_id, fish_name, fish_rarity, fish_rarity_point)
      VALUES (${row.fish_id}, ${row.fish_name}, ${row.fish_rarity}, ${row.fish_rarity_point})
      ON CONFLICT DO NOTHING RETURNING fish_id`,
);

await copyTable(
  "caught_fishes",
  () => legacy.query(CAUGHT_SQL).all() as AnyRow[],
  (row) =>
    sql`INSERT INTO caught_fishes
      (id, username, user_id, fish_name, fish_weight, fish_size, fish_rarity, fish_rarity_point, fish_price, chat_id)
      VALUES (${row.id}, ${row.username}, ${row.user_id}, ${row.fish_name}, ${row.fish_weight}, ${row.fish_size},
      ${row.fish_rarity}, ${row.fish_rarity_point}, ${row.fish_price}, ${row.chat_id})
      ON CONFLICT DO NOTHING RETURNING id`,
);

await copyTable(
  "catch_time",
  () => legacy.query(CATCH_TIME_SQL).all() as AnyRow[],
  (row) =>
    sql`INSERT INTO catch_time (user_id, chat_id, last_catch_time)
      VALUES (${row.user_id}, ${row.chat_id}, ${row.last_catch_time})
      ON CONFLICT (user_id, chat_id) DO NOTHING RETURNING user_id`,
);

await copyTable(
  "fishers",
  () => legacy.query(FISHERS_SQL).all() as AnyRow[],
  (row) =>
    sql`INSERT INTO fishers (user_id, chat_id, user_first_name, user_balance)
      VALUES (${row.user_id}, ${row.chat_id}, ${row.user_first_name}, ${row.user_balance})
      ON CONFLICT DO NOTHING RETURNING user_id`,
);

legacy.close();
await sql.end();
