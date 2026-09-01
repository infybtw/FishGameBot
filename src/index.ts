import { loadConfig } from "./config.ts";
import { BOT_VERSION_LABEL } from "./version.ts";
import { log } from "./logger.ts";
import { createRepo, createSql, migrateSchema } from "./db/index.ts";
import { seedDefaultFish } from "./db/seed.ts";
import { loadCatalog, setCatalog } from "./features/fishing/catalog.ts";
import { createBot, type CatalogAccess } from "./bot.ts";

async function main(): Promise<void> {
  log.info({ version: BOT_VERSION_LABEL }, "Starting fishbot");
  const cfg = loadConfig();
  log.debug("Configuration loaded");
  const sql = createSql(cfg.databaseUrl);
  await migrateSchema(sql);
  log.debug("Database schema is up to date");
  const repo = createRepo(sql);

  const seeded = await seedDefaultFish(repo);
  if (seeded > 0) log.info({ seeded }, "Seeded default fish list");

  const catalogAccess: CatalogAccess = {
    async reload() {
      try {
        const catalog = await loadCatalog(repo);
        if (catalog.length === 0) return null;
        setCatalog(catalog);
        return catalog;
      } catch (err) {
        log.error({ err }, "Failed to load fish catalog");
        return null;
      }
    },
  };

  const bot = createBot(cfg, repo, catalogAccess);

  const catalog = await loadCatalog(repo);
  if (catalog.length === 0) {
    log.error("Fish list is empty, refusing to start");
    try {
      await bot.api.sendMessage(cfg.adminUserId, "Error while loading fish list\n");
    } catch (err) {
      log.error({ err }, "Failed to notify admin about the empty fish list");
    }
    process.exit(1);
  }
  setCatalog(catalog);
  const templateCount = catalog.reduce((sum, group) => sum + (group?.length ?? 0), 0);
  log.info({ templates: templateCount }, "Fish catalog loaded");

  await bot.start({ onStart: () => log.info("Bot started") });
  log.info("Bot stopped");

  // bot.start resolves after grammY's built-in SIGINT/SIGTERM handling stops the bot.
  await sql.end().catch((err) => log.debug({ err }, "Connection pool close skipped"));
}

main().catch((err) => {
  log.error({ err }, "Startup failed");
  process.exit(1);
});
