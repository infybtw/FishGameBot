import type { Context } from "grammy";
import { createConversation } from "@grammyjs/conversations";
import { InputFile, type Bot } from "grammy";
import type { BotContext, CatalogAccess, FishConversation } from "../../bot.ts";
import type { Config } from "../../config.ts";
import type { FishTemplateInsert, FishTemplateRow, Repo } from "../../db/index.ts";
import { isAdmin } from "../../guards.ts";
import { log } from "../../logger.ts";

const ADD_INVITE =
  "Введите данные для добавления новой рыбы в формате:\nfish_name/fish_rarity/fish_rarity_point";
const ADD_OK = "Рыба успешно добавленна";
const ADD_FAIL = "Во время добавления рыбы произошла критическая ошибка";
const REMOVE_PROMPT = "Выберите ID рыбы которую хотите удалить";
const REMOVE_FAIL = "Произошла ошибка";
const CANCEL_OK = "Состояние сброшено";
const EMPTY_LIST = "Список рыб пуст";
const RELOAD_OK = "Список успешно перезагружен";
const RELOAD_FAIL = "Во время перезагрузки списка произошла ошибка";
const IMPORT_INVITE =
  'Отправьте JSON-файл со списком рыб.\nФормат: массив объектов {"name", "rarity", "point"}.\nТекущий список рыб будет заменён.';
const IMPORT_FAIL = "Во время импорта рыбы произошла критическая ошибка";
const EXPORT_FAIL = "Произошла ошибка";

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

function templateList(templates: FishTemplateRow[]): string {
  if (templates.length === 0) return EMPTY_LIST;
  return templates.map((t) => `${t.id}. ${t.name} - ${t.rarity}(${t.point})`).join("\n");
}

function parseFishJson(text: string): FishTemplateInsert[] | null {
  try {
    const data: unknown = JSON.parse(text);
    if (!Array.isArray(data)) return null;
    const templates: FishTemplateInsert[] = [];
    for (const item of data) {
      if (typeof item !== "object" || item === null) return null;
      const { name, rarity, point } = item as Record<string, unknown>;
      if (typeof name !== "string" || name.trim() === "") return null;
      if (typeof rarity !== "string" || rarity.trim() === "") return null;
      const parsedPoint = typeof point === "number" ? point : typeof point === "string" ? Number(point) : NaN;
      if (!Number.isInteger(parsedPoint) || parsedPoint < 1) return null;
      templates.push({ name: name.trim(), rarity: rarity.trim(), point: parsedPoint });
    }
    return templates;
  } catch {
    return null;
  }
}

function logAdminRejected(ctx: Context, command: string): void {
  log.debug(
    { command, userId: ctx.from?.id, chatId: ctx.chat?.id },
    "Admin command rejected: caller is not the admin",
  );
}

function addFishConversation(cfg: Config, repo: Repo) {
  return async (conversation: FishConversation, ctx: Context): Promise<void> => {
    await ctx.reply(ADD_INVITE);
    const received = await conversation.waitUntil(
      (c) => c.from?.id === cfg.adminUserId && typeof c.message?.text === "string",
    );
    const text = received.message?.text;
    if (text === undefined) {
      await received.reply(ADD_FAIL);
      return;
    }
    log.debug({ text: text.slice(0, 100) }, "Received fish data from admin");
    const parts = text.split("/").map((part) => part.trim());
    if (parts.length !== 3) {
      log.warn({ text: text.slice(0, 100) }, "Invalid fish data received");
      await received.reply(ADD_FAIL);
      return;
    }
    const name = parts[0]!;
    const rarity = parts[1]!;
    const point = Number(parts[2]);
    if (!Number.isInteger(point) || point < 1) {
      log.warn({ text: text.slice(0, 100) }, "Invalid fish data received");
      await received.reply(ADD_FAIL);
      return;
    }
    try {
      await repo.insertTemplate(name, rarity, point);
    } catch (err) {
      log.warn({ err, name, rarity, point }, "Fish template insert failed");
      await received.reply(ADD_FAIL);
      return;
    }
    log.info({ name, rarity, point }, "Fish template added");
    await received.reply(ADD_OK);
  };
}

function removeFishConversation(cfg: Config, repo: Repo) {
  return async (conversation: FishConversation, ctx: Context): Promise<void> => {
    const templates = await repo.listTemplates();
    await ctx.reply(templateList(templates));
    if (templates.length === 0) return;
    await ctx.reply(REMOVE_PROMPT);
    const received = await conversation.waitUntil(
      (c) => c.from?.id === cfg.adminUserId && typeof c.message?.text === "string",
    );
    const id = Number(received.message?.text);
    log.debug({ answer: received.message?.text }, "Received fish id from admin");
    try {
      await repo.deleteTemplate(id);
    } catch (err) {
      log.warn({ err, id }, "Fish template deletion failed");
      await received.reply(REMOVE_FAIL);
      return;
    }
    log.info({ id }, "Fish template deleted");
    await received.reply(`Рыба с ID: ${id} была удалена`);
  };
}

function importFishConversation(cfg: Config, repo: Repo, catalogAccess: CatalogAccess) {
  return async (conversation: FishConversation, ctx: Context): Promise<void> => {
    await ctx.reply(IMPORT_INVITE);
    const received = await conversation.waitUntil(
      (c) => c.from?.id === cfg.adminUserId && c.message?.document !== undefined,
    );
    try {
      const document = received.message?.document;
      if (document === undefined || (document.file_size ?? 0) > MAX_IMPORT_FILE_BYTES) {
        throw new Error("unsupported document");
      }
      log.info({ fileName: document.file_name, fileSize: document.file_size }, "Import file received");
      const file = await received.api.getFile(document.file_id);
      if (file.file_path === undefined) throw new Error("file path unavailable");
      const response = await fetch(`https://api.telegram.org/file/bot${cfg.botToken}/${file.file_path}`);
      if (!response.ok) throw new Error(`download failed: ${response.status}`);
      const templates = parseFishJson(new TextDecoder().decode(await response.arrayBuffer()));
      if (templates === null) {
        log.warn("Import file contains invalid fish JSON");
        await received.reply(IMPORT_FAIL);
        return;
      }
      const imported = await repo.replaceAllTemplates(templates);
      if ((await catalogAccess.reload()) === null) {
        log.error("Fish list reload failed after import");
        await received.reply(RELOAD_FAIL);
        return;
      }
      log.info({ imported }, "Fish list imported");
      await received.reply(`Импортировано рыб: ${imported}`);
    } catch (err) {
      log.error({ err }, "Fish import failed");
      await received.reply(IMPORT_FAIL);
    }
  };
}

export function registerAdminCommands(
  bot: Bot<BotContext>,
  cfg: Config,
  repo: Repo,
  catalogAccess: CatalogAccess,
): void {
  bot.use(createConversation(addFishConversation(cfg, repo), "addFish"));
  bot.use(createConversation(removeFishConversation(cfg, repo), "removeFish"));
  bot.use(createConversation(importFishConversation(cfg, repo, catalogAccess), "importFish"));

  bot.command("add_new_fish", async (ctx) => {
    if (!isAdmin(ctx, cfg.adminUserId)) {
      logAdminRejected(ctx, "add_new_fish");
      return;
    }
    await ctx.conversation.enter("addFish");
  });

  bot.command("remove_fish", async (ctx) => {
    if (!isAdmin(ctx, cfg.adminUserId)) {
      logAdminRejected(ctx, "remove_fish");
      return;
    }
    await ctx.conversation.enter("removeFish");
  });

  bot.command("import_fish", async (ctx) => {
    if (!isAdmin(ctx, cfg.adminUserId)) {
      logAdminRejected(ctx, "import_fish");
      return;
    }
    await ctx.conversation.enter("importFish");
  });

  bot.command("export_fish", async (ctx) => {
    if (!isAdmin(ctx, cfg.adminUserId)) {
      logAdminRejected(ctx, "export_fish");
      return;
    }
    try {
      const templates = await repo.listTemplates();
      const json = JSON.stringify(
        templates.map(({ name, rarity, point }) => ({ name, rarity, point })),
        null,
        2,
      );
      const filename = `fishes-${new Date().toISOString().slice(0, 10)}.json`;
      await ctx.replyWithDocument(new InputFile(Buffer.from(json), filename));
      log.info({ fileName: filename, count: templates.length }, "Fish list exported");
    } catch (err) {
      log.error({ err }, "Fish export failed");
      await ctx.reply(EXPORT_FAIL);
    }
  });

  bot.command("cancel", async (ctx) => {
    if (!isAdmin(ctx, cfg.adminUserId)) {
      logAdminRejected(ctx, "cancel");
      return;
    }
    await ctx.conversation.exitAll();
    log.info("Conversations reset by admin");
    await ctx.reply(CANCEL_OK);
  });

  bot.command("get_fish_list", async (ctx) => {
    if (!isAdmin(ctx, cfg.adminUserId)) {
      logAdminRejected(ctx, "get_fish_list");
      return;
    }
    const templates = await repo.listTemplates();
    log.debug({ templates: templates.length }, "Fish list sent to admin");
    await ctx.reply(templateList(templates));
  });

  bot.command("reload_fish_list", async (ctx) => {
    if (!isAdmin(ctx, cfg.adminUserId)) {
      logAdminRejected(ctx, "reload_fish_list");
      return;
    }
    if ((await catalogAccess.reload()) === null) {
      log.error("Fish list reload failed");
      await ctx.reply(RELOAD_FAIL);
      return;
    }
    log.info("Fish list reloaded");
    await ctx.reply(RELOAD_OK);
  });
}
