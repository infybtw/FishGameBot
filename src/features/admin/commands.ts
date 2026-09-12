import type { Context } from "grammy";
import { createConversation } from "@grammyjs/conversations";
import { InlineKeyboard, InputFile, type Bot } from "grammy";
import type { BotContext, CatalogAccess, FishConversation } from "../../bot.ts";
import type { Config } from "../../config.ts";
import type { FishTemplateInsert, FishTemplateRow, Repo } from "../../db/index.ts";
import { isAdmin, isGroup } from "../../guards.ts";
import { escapeHtml } from "../../lib/format.ts";
import { log } from "../../logger.ts";
import { inventoryCard, inventoryFishCard, profileCard } from "../upgrades/messages.ts";
import { getRod, RODS } from "../upgrades/rods.ts";

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
const CCLEAR_USAGE = "Использование: /cclear или /cclear <количество>";
const CCLEAR_OK = (deleted: number) => `Удалено сообщений и команд: ${deleted}`;
const APROFILE_USAGE = "Использование: ответьте командой /aprofile на сообщение игрока.";
const APROFILE_EMPTY = "У этого игрока ещё нет профиля в этом чате.";
const APROFILE_STALE = "Меню устарело. Откройте профиль заново.";

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

function parseClearLimit(raw: string): number | null | undefined {
  const value = raw.trim();
  if (value === "") return undefined;
  if (!/^\d+$/.test(value)) return null;
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit > 0 ? limit : null;
}

type AProfileAction =
  | { kind: "home" | "rods" }
  | { kind: "fish"; page: number }
  | { kind: "fishDetail" | "sellFish" | "removeFish"; fishId: number }
  | { kind: "rodDetail" | "grantRod" | "removeRod"; rodId: string };

function buildAprofileCallback(targetUserId: number, action: AProfileAction): string {
  const prefix = `ap:${targetUserId}:`;
  const payload =
    action.kind === "fish" ? `${prefix}fish:${action.page}` :
    action.kind === "fishDetail" ? `${prefix}fd:${action.fishId}` :
    action.kind === "sellFish" ? `${prefix}sell:${action.fishId}` :
    action.kind === "removeFish" ? `${prefix}rmf:${action.fishId}` :
    action.kind === "rodDetail" ? `${prefix}rd:${action.rodId}` :
    action.kind === "grantRod" ? `${prefix}grant:${action.rodId}` :
    action.kind === "removeRod" ? `${prefix}rmr:${action.rodId}` :
    `${prefix}${action.kind}`;
  if (Buffer.byteLength(payload, "utf8") > 64) throw new Error("Telegram callback_data exceeds 64 bytes");
  return payload;
}

function parseAprofileCallback(payload: string): { targetUserId: number; action: AProfileAction } | null {
  const match = /^ap:([1-9]\d*):(home|rods|fish:([1-9]\d*)|(fd|sell|rmf):([1-9]\d*)|(rd|grant|rmr):([a-z]+))$/.exec(payload);
  if (match === null) return null;
  const targetUserId = Number(match[1]);
  if (!Number.isSafeInteger(targetUserId)) return null;
  if (match[2] === "home" || match[2] === "rods") return { targetUserId, action: { kind: match[2] } };
  if (match[3] !== undefined) return { targetUserId, action: { kind: "fish", page: Number(match[3]) } };
  if (match[4] === "fd" || match[4] === "sell" || match[4] === "rmf") {
    const kinds = { fd: "fishDetail", sell: "sellFish", rmf: "removeFish" } as const;
    return { targetUserId, action: { kind: kinds[match[4]], fishId: Number(match[5]) } };
  }
  if (match[6] !== undefined && match[7] !== undefined && getRod(match[7]) !== undefined) {
    const kinds = { rd: "rodDetail", grant: "grantRod", rmr: "removeRod" } as const;
    return { targetUserId, action: { kind: kinds[match[6] as keyof typeof kinds], rodId: match[7] } };
  }
  return null;
}

type AProfileScreen = { text: string; keyboard: InlineKeyboard };

async function renderAprofileHome(repo: Repo, cfg: Config, userId: number, chatId: number): Promise<AProfileScreen> {
  const [fisher, inventory, equippedRodId] = await Promise.all([
    repo.getFisher(userId, chatId),
    repo.getInventoryPage(userId, chatId, 1, 5),
    repo.getEquippedRodId(userId, chatId),
  ]);
  if (fisher === null) return { text: APROFILE_EMPTY, keyboard: new InlineKeyboard() };
  const rod = getRod(equippedRodId ?? "basic") ?? getRod("basic")!;
  return {
    text: `<b>Админ-профиль: ${escapeHtml(fisher.firstName)}</b>\n\n${profileCard(fisher.balance, rod, cfg.catchSuccessChance, inventory.totalCount, inventory.totalValue)}`,
    keyboard: new InlineKeyboard()
      .text("Рыба", buildAprofileCallback(userId, { kind: "fish", page: 1 }))
      .text("Удочки", buildAprofileCallback(userId, { kind: "rods" })),
  };
}

async function renderAprofileFish(repo: Repo, userId: number, chatId: number, page: number): Promise<AProfileScreen> {
  const inventory = await repo.getInventoryPage(userId, chatId, page, 5);
  const keyboard = new InlineKeyboard();
  for (const fish of inventory.fishes) keyboard.text(`Рыба #${fish.id}`, buildAprofileCallback(userId, { kind: "fishDetail", fishId: fish.id })).row();
  if (inventory.page > 1) keyboard.text("←", buildAprofileCallback(userId, { kind: "fish", page: inventory.page - 1 }));
  if (inventory.page * 5 < inventory.totalCount) keyboard.text("→", buildAprofileCallback(userId, { kind: "fish", page: inventory.page + 1 }));
  if (inventory.page > 1 || inventory.page * 5 < inventory.totalCount) keyboard.row();
  keyboard.text("Назад", buildAprofileCallback(userId, { kind: "home" }));
  return { text: `<b>Админ: рыба</b>\n\n${inventoryCard(inventory)}`, keyboard };
}

async function renderAprofileFishDetail(repo: Repo, userId: number, chatId: number, fishId: number): Promise<AProfileScreen> {
  const fish = await repo.getInventoryFish(userId, chatId, fishId);
  if (fish === null) return { text: "Эта рыба уже недоступна.", keyboard: new InlineKeyboard().text("К рыбе", buildAprofileCallback(userId, { kind: "fish", page: 1 })) };
  return {
    text: `<b>Админ: рыба игрока</b>\n\n${inventoryFishCard(fish)}`,
    keyboard: new InlineKeyboard()
      .text("Продать", buildAprofileCallback(userId, { kind: "sellFish", fishId }))
      .text("Удалить", buildAprofileCallback(userId, { kind: "removeFish", fishId }))
      .row()
      .text("Назад", buildAprofileCallback(userId, { kind: "fish", page: 1 })),
  };
}

async function renderAprofileRods(repo: Repo, userId: number, chatId: number): Promise<AProfileScreen> {
  const [purchased, equipped] = await Promise.all([repo.listPurchasedRodIds(userId, chatId), repo.getEquippedRodId(userId, chatId)]);
  const owned = new Set(purchased);
  const keyboard = new InlineKeyboard();
  const lines = ["🎣 <b>Админ: удочки</b>", "", "Выберите удочку для управления:"];
  for (const rod of RODS) {
    const purchased = rod.id === "basic" || owned.has(rod.id);
    lines.push(`${purchased ? "✅" : "❌"} ${rod.name}${equipped === rod.id ? " (экипирована)" : ""}`);
    keyboard.text(`${purchased ? "✅" : "❌"} ${rod.name}`, buildAprofileCallback(userId, { kind: "rodDetail", rodId: rod.id })).row();
  }
  keyboard.text("Назад", buildAprofileCallback(userId, { kind: "home" }));
  return { text: lines.join("\n"), keyboard };
}

async function renderAprofileRodDetail(repo: Repo, userId: number, chatId: number, rodId: string): Promise<AProfileScreen> {
  const rod = getRod(rodId);
  if (rod === undefined) throw new Error("Unknown rod in validated callback");
  const [purchased, equipped] = await Promise.all([repo.listPurchasedRodIds(userId, chatId), repo.getEquippedRodId(userId, chatId)]);
  const owned = rod.id === "basic" || purchased.includes(rod.id);
  const lines = [
    `🎣 <b>${escapeHtml(rod.name)}</b>`,
    "",
    `<b>Статус:</b> ${owned ? "✅ Выдана" : "❌ Не выдана"}${equipped === rod.id ? " · экипирована" : ""}`,
    `<b>Бонус к поимке:</b> +${rod.catchBonusPoints} п.п.`,
    `<b>Бонус редкости:</b> +${rod.rarityStepBonus * 100}% за шаг`,
  ];
  const keyboard = new InlineKeyboard();
  if (rod.id !== "basic") keyboard.text(owned ? "Удалить удочку" : "Выдать удочку", buildAprofileCallback(userId, owned ? { kind: "removeRod", rodId } : { kind: "grantRod", rodId })).row();
  keyboard.text("Назад", buildAprofileCallback(userId, { kind: "rods" }));
  return { text: lines.join("\n"), keyboard };
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

  bot.command("cclear", async (ctx) => {
    if (!isAdmin(ctx, cfg.adminUserId)) {
      logAdminRejected(ctx, "cclear");
      return;
    }
    if (ctx.chat === undefined) return;

    const limit = parseClearLimit(ctx.match);
    if (limit === null) {
      await ctx.reply(CCLEAR_USAGE);
      return;
    }

    const messageIds = await repo.listRecentClearableMessageIds(ctx.chat.id, limit);
    let deleted = 0;
    for (const messageId of messageIds) {
      try {
        await ctx.api.deleteMessage(ctx.chat.id, messageId);
        await repo.markChatMessageDeleted(ctx.chat.id, messageId);
        deleted += 1;
      } catch (err) {
        log.warn({ err, chatId: ctx.chat.id, messageId }, "Failed to delete tracked message");
      }
    }
    log.info({ chatId: ctx.chat.id, requested: limit ?? "all", deleted }, "Bot messages and commands cleared by admin");
    await ctx.reply(CCLEAR_OK(deleted));
  });

  bot.command("aprofile", async (ctx) => {
    if (!isAdmin(ctx, cfg.adminUserId)) {
      logAdminRejected(ctx, "aprofile");
      return;
    }
    if (!isGroup(ctx)) return;
    const target = ctx.message?.reply_to_message?.from;
    if (target === undefined || target.is_bot) {
      await ctx.reply(APROFILE_USAGE);
      return;
    }
    const screen = await renderAprofileHome(repo, cfg, target.id, ctx.chat.id);
    await ctx.api.sendMessage(ctx.chat.id, screen.text, {
      reply_markup: screen.keyboard,
      ephemeral_message_parameters: { receiver_user_id: cfg.adminUserId },
    });
    await ctx.deleteMessage();
  });

  bot.callbackQuery(/^ap:/, async (ctx) => {
    const parsed = parseAprofileCallback(ctx.callbackQuery.data);
    const message = ctx.callbackQuery.message;
    if (
      parsed === null ||
      !isAdmin(ctx, cfg.adminUserId) ||
      ctx.from === undefined ||
      !isGroup(ctx) ||
      message === undefined ||
      message.receiver_user?.id !== cfg.adminUserId ||
      message.ephemeral_message_id === undefined
    ) {
      await ctx.answerCallbackQuery({ text: APROFILE_STALE, show_alert: true });
      return;
    }

    const { targetUserId, action } = parsed;
    const chatId = message.chat.id;
    let screen: AProfileScreen;
    let answerText: string | undefined;
    switch (action.kind) {
      case "home":
        screen = await renderAprofileHome(repo, cfg, targetUserId, chatId);
        break;
      case "fish":
        screen = await renderAprofileFish(repo, targetUserId, chatId, action.page);
        break;
      case "fishDetail":
        screen = await renderAprofileFishDetail(repo, targetUserId, chatId, action.fishId);
        break;
      case "rods":
        screen = await renderAprofileRods(repo, targetUserId, chatId);
        break;
      case "rodDetail":
        screen = await renderAprofileRodDetail(repo, targetUserId, chatId, action.rodId);
        break;
      case "sellFish": {
        const result = await repo.sellFish(targetUserId, chatId, action.fishId);
        answerText = result.status === "sold" ? "Рыба продана игроку." : "Рыба уже недоступна.";
        screen = await renderAprofileFish(repo, targetUserId, chatId, Number.MAX_SAFE_INTEGER);
        break;
      }
      case "removeFish": {
        const removed = await repo.removeInventoryFish(targetUserId, chatId, action.fishId);
        answerText = removed ? "Рыба удалена." : "Рыба уже недоступна.";
        screen = await renderAprofileFish(repo, targetUserId, chatId, Number.MAX_SAFE_INTEGER);
        break;
      }
      case "removeRod": {
        const removed = await repo.removePurchasedRod(targetUserId, chatId, action.rodId);
        answerText = removed ? "Удочка удалена." : "Удочка уже недоступна.";
        screen = await renderAprofileRods(repo, targetUserId, chatId);
        break;
      }
      case "grantRod": {
        const granted = await repo.grantPurchasedRod(targetUserId, chatId, action.rodId);
        answerText = granted ? "Удочка выдана." : "Удочка уже выдана.";
        screen = await renderAprofileRodDetail(repo, targetUserId, chatId, action.rodId);
        break;
      }
    }
    await ctx.editEphemeralMessageText(screen.text, { reply_markup: screen.keyboard });
    await ctx.answerCallbackQuery(answerText === undefined ? undefined : { text: answerText });
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
