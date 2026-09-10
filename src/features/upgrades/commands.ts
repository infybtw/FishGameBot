import { InlineKeyboard, type Bot, type Context } from "grammy";
import type { BotContext } from "../../bot.ts";
import type { Config } from "../../config.ts";
import type { EquipResult, PurchaseResult, RarityInventorySummary, Repo, SaleResult } from "../../db/index.ts";
import { isGroup } from "../../guards.ts";
import { log } from "../../logger.ts";
import { getCatalog } from "../fishing/catalog.ts";
import { buildCallbackData, parseCallbackData } from "./callback-data.ts";
import {
  inventoryCard,
  money,
  profileCard,
  rarityLabel,
  raritySaleCard,
  raritySaleConfirmation,
  rodDetailCard,
  rodsCard,
} from "./messages.ts";
import { getRod, RODS, type RodDefinition, type RodId } from "./rods.ts";

const PAGE_SIZE = 5;
const FOREIGN_MENU_ALERT = "Это меню принадлежит другому игроку.";
const STALE_MENU_ALERT = "Кнопка устарела. Откройте /profile заново.";

type Screen = { text: string; keyboard: InlineKeyboard };


type RodContext = {
  balance: number;
  equippedRodId: RodId;
  purchasedRodIds: Set<string>;
  inventory: RarityInventorySummary[];
};

function rodState(rodId: RodId, equippedRodId: RodId, purchasedRodIds: ReadonlySet<string>): string {
  if (rodId === equippedRodId) return "Экипирована";
  return rodId === "basic" || purchasedRodIds.has(rodId) ? "Куплена" : "Не куплена";
}

function homeKeyboard(ownerUserId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("🎒 Инвентарь", buildCallbackData(ownerUserId, { kind: "fish", page: 1 }))
    .row()
    .text("🎣 Удочки", buildCallbackData(ownerUserId, { kind: "rods" }));
}

async function renderHome(repo: Repo, cfg: Config, userId: number, chatId: number): Promise<Screen> {
  const [fisher, inventory, equippedId] = await Promise.all([
    repo.getFisher(userId, chatId),
    repo.getInventoryPage(userId, chatId, 1, PAGE_SIZE),
    repo.getEquippedRodId(userId, chatId),
  ]);
  if (fisher === null) throw new Error("Profile rendering requires an existing fisher");
  const rod = getRod(equippedId ?? "basic") ?? getRod("basic")!;
  return {
    text: profileCard(fisher.balance, rod, cfg.catchSuccessChance, inventory.totalCount, inventory.totalValue),
    keyboard: homeKeyboard(userId),
  };
}

async function renderInventory(repo: Repo, userId: number, chatId: number, page: number): Promise<Screen> {
  const inventory = await repo.getInventoryPage(userId, chatId, page, PAGE_SIZE);
  const keyboard = new InlineKeyboard();
  for (const fish of inventory.fishes) {
    keyboard.text(`Продать #${fish.id}`, buildCallbackData(userId, { kind: "sell", fishId: fish.id })).row();
  }
  if (inventory.page > 1) keyboard.text("←", buildCallbackData(userId, { kind: "fish", page: inventory.page - 1 }));
  if (inventory.page * PAGE_SIZE < inventory.totalCount) keyboard.text("→", buildCallbackData(userId, { kind: "fish", page: inventory.page + 1 }));
  if (inventory.page > 1 || inventory.page * PAGE_SIZE < inventory.totalCount) keyboard.row();
  keyboard
    .text("Продать по редкости", buildCallbackData(userId, { kind: "rarities" }))
    .row()
    .text("Назад", buildCallbackData(userId, { kind: "home" }));
  return { text: inventoryCard(inventory), keyboard };
}

async function renderRarities(repo: Repo, userId: number, chatId: number): Promise<Screen> {
  const summaries = await repo.getRarityInventory(userId, chatId);
  const keyboard = new InlineKeyboard();
  for (const summary of summaries) {
    keyboard.text(`${rarityLabel(summary.point)} (${summary.count})`, buildCallbackData(userId, { kind: "rarity", point: summary.point })).row();
  }
  keyboard.text("Назад", buildCallbackData(userId, { kind: "fish", page: 1 }));
  return { text: raritySaleCard(summaries), keyboard };
}

function renderRarityConfirmation(userId: number, point: number, count: number, total: number, maxFishId: number): Screen {
  return {
    text: raritySaleConfirmation(point, count, total),
    keyboard: new InlineKeyboard()
      .text("Подтвердить", buildCallbackData(userId, { kind: "sellr", point, maxFishId }))
      .row()
      .text("Отмена", buildCallbackData(userId, { kind: "rarities" })),
  };
}

async function rodContext(repo: Repo, userId: number, chatId: number): Promise<RodContext> {
  const [fisher, equippedId, purchasedRodIds, inventory] = await Promise.all([
    repo.getFisher(userId, chatId),
    repo.getEquippedRodId(userId, chatId),
    repo.listPurchasedRodIds(userId, chatId),
    repo.getRarityInventory(userId, chatId),
  ]);
  if (fisher === null) throw new Error("Rod rendering requires an existing fisher");
  return {
    balance: fisher.balance,
    equippedRodId: (getRod(equippedId ?? "basic") ?? getRod("basic")!).id,
    purchasedRodIds: new Set(purchasedRodIds),
    inventory,
  };
}

async function renderRods(repo: Repo, userId: number, chatId: number): Promise<Screen> {
  const context = await rodContext(repo, userId, chatId);
  const keyboard = new InlineKeyboard();
  const rods = RODS.map((rod) => ({ rod, state: rodState(rod.id, context.equippedRodId, context.purchasedRodIds) }));
  for (const rod of RODS) keyboard.text(rod.name, buildCallbackData(userId, { kind: "rod", rodId: rod.id })).row();
  keyboard.text("Назад", buildCallbackData(userId, { kind: "home" }));
  return { text: rodsCard(rods), keyboard };
}

async function renderRodDetail(
  repo: Repo,
  userId: number,
  chatId: number,
  rod: RodDefinition,
  notice?: string,
): Promise<Screen> {
  const context = await rodContext(repo, userId, chatId);
  const state = rodState(rod.id, context.equippedRodId, context.purchasedRodIds);
  const unavailablePoints = new Set<number>();
  const catalog = getCatalog();
  for (const requirement of rod.recipe) {
    if (catalog[requirement.point - 1]?.length !== undefined && catalog[requirement.point - 1]!.length === 0) {
      unavailablePoints.add(requirement.point);
    }
    if (catalog[requirement.point - 1] === undefined) unavailablePoints.add(requirement.point);
  }
  const keyboard = new InlineKeyboard();
  if (state === "Куплена") keyboard.text("Экипировать", buildCallbackData(userId, { kind: "equip", rodId: rod.id })).row();
  if (state === "Не куплена") keyboard.text("Купить и экипировать", buildCallbackData(userId, { kind: "buy", rodId: rod.id })).row();
  keyboard.text("Назад", buildCallbackData(userId, { kind: "rods" }));
  const text = rodDetailCard(rod, state, context.balance, context.inventory, unavailablePoints);
  return { text: notice === undefined ? text : `${text}\n\n⚠️ ${notice}`, keyboard };
}


function purchaseFailureMessage(result: Exclude<PurchaseResult, { status: "purchased" } | { status: "already_owned" }>): string {
  switch (result.status) {
    case "missing_prerequisite":
      return `Сначала купите ${getRod(result.rodId)?.name ?? result.rodId}.`;
    case "insufficient_balance":
      return `Не хватает средств: нужно ${money(result.required)}, доступно ${money(result.available)}.`;
    case "insufficient_fish":
      return `Не хватает рыбы «${rarityLabel(result.point)}»: нужно ${result.required}, доступно ${result.available}.`;
  }
}

async function answerStale(ctx: Context, userId: number | undefined, chatId: number | undefined, reason: string): Promise<void> {
  log.info({ userId, chatId, reason }, "Stale upgrade callback rejected");
  await ctx.answerCallbackQuery({ text: STALE_MENU_ALERT, show_alert: true });
}

export function registerUpgradeCommands(bot: Bot<BotContext>, cfg: Config, repo: Repo): void {
  bot.command("profile", async (ctx) => {
    if (!isGroup(ctx) || ctx.from === undefined) return;
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    await repo.ensureFisher(userId, chatId, ctx.from.first_name);
    const screen = await renderHome(repo, cfg, userId, chatId);
    await ctx.api.sendMessage(chatId, screen.text, {
      reply_markup: screen.keyboard,
      ephemeral_message_parameters: { receiver_user_id: userId },
    });
    await ctx.deleteMessage();
  });

  bot.callbackQuery(/^upg:/, async (ctx) => {
    const parsed = parseCallbackData(ctx.callbackQuery.data);
    if (parsed === null || ctx.from === undefined) {
      await answerStale(ctx, ctx.from?.id, ctx.chat?.id, "malformed callback or missing sender");
      return;
    }
    if (parsed.ownerUserId !== ctx.from.id) {
      log.warn({ userId: ctx.from.id, chatId: ctx.chat?.id, ownerUserId: parsed.ownerUserId }, "Foreign upgrade callback rejected");
      await ctx.answerCallbackQuery({ text: FOREIGN_MENU_ALERT, show_alert: true });
      return;
    }
    const callbackMessage = ctx.callbackQuery.message;
    if (
      !isGroup(ctx) ||
      callbackMessage === undefined ||
      callbackMessage.receiver_user?.id !== ctx.from.id ||
      callbackMessage.ephemeral_message_id === undefined
    ) {
      await answerStale(ctx, ctx.from.id, ctx.chat?.id, "missing owner-bound ephemeral message");
      return;
    }

    const userId = ctx.from.id;
    const chatId = callbackMessage.chat.id;
    let screen: Screen;
    let answerText: string | undefined;
    switch (parsed.action.kind) {
      case "home":
        screen = await renderHome(repo, cfg, userId, chatId);
        break;
      case "fish":
        screen = await renderInventory(repo, userId, chatId, parsed.action.page);
        break;
      case "sell": {
        const result: SaleResult = await repo.sellFish(userId, chatId, parsed.action.fishId);
        if (result.status === "sold") {
          log.info({ userId, chatId, fishId: parsed.action.fishId, count: result.count, total: result.total }, "Inventory fish sold");
          answerText = `Продано: ${money(result.total)}`;
        } else {
          log.info({ userId, chatId, fishId: parsed.action.fishId }, "Stale individual sale rejected");
          answerText = "Рыба уже недоступна.";
        }
        screen = await renderInventory(repo, userId, chatId, Number.MAX_SAFE_INTEGER);
        break;
      }
      case "rarities":
        screen = await renderRarities(repo, userId, chatId);
        break;
      case "rarity": {
        const preview = await repo.getRaritySalePreview(userId, chatId, parsed.action.point);
        if (preview === null) {
          await answerStale(ctx, userId, chatId, "missing rarity sale preview");
          return;
        }
        screen = renderRarityConfirmation(userId, parsed.action.point, preview.count, preview.total, preview.maxFishId);
        break;
      }
      case "sellr": {
        const result = await repo.sellRarity(userId, chatId, parsed.action.point, parsed.action.maxFishId);
        if (result.status === "sold") {
          log.info({ userId, chatId, point: parsed.action.point, maxFishId: parsed.action.maxFishId, count: result.count, total: result.total }, "Inventory rarity sold");
          answerText = `Продано: ${money(result.total)}`;
        } else {
          log.info({ userId, chatId, point: parsed.action.point, maxFishId: parsed.action.maxFishId }, "Stale rarity sale rejected");
          answerText = "Рыба уже недоступна.";
        }
        screen = await renderRarities(repo, userId, chatId);
        break;
      }
      case "rods":
        screen = await renderRods(repo, userId, chatId);
        break;
      case "rod": {
        const rod = getRod(parsed.action.rodId);
        if (rod === undefined) {
          await answerStale(ctx, userId, chatId, "unknown rod detail");
          return;
        }
        screen = await renderRodDetail(repo, userId, chatId, rod);
        break;
      }
      case "buy": {
        const rod = getRod(parsed.action.rodId);
        if (rod === undefined || rod.id === "basic") {
          await answerStale(ctx, userId, chatId, "invalid rod purchase");
          return;
        }
        const result = await repo.purchaseRod(userId, chatId, {
          rodId: rod.id,
          prerequisite: rod.prerequisite,
          price: rod.price,
          recipe: rod.recipe,
        });
        if (result.status === "purchased") {
          log.info({ userId, chatId, rodId: rod.id, price: rod.price, balance: result.balance }, "Rod purchased and equipped");
          screen = await renderRods(repo, userId, chatId);
          answerText = "Удочка куплена и экипирована.";
        } else if (result.status === "already_owned") {
          screen = await renderRodDetail(repo, userId, chatId, rod, "Эта удочка уже куплена.");
        } else {
          screen = await renderRodDetail(repo, userId, chatId, rod, purchaseFailureMessage(result));
        }
        break;
      }
      case "equip": {
        const rod = getRod(parsed.action.rodId);
        if (rod === undefined) {
          await answerStale(ctx, userId, chatId, "unknown rod equip");
          return;
        }
        const result: EquipResult = await repo.equipRod(userId, chatId, rod.id);
        if (result.status === "equipped") {
          log.info({ userId, chatId, rodId: rod.id }, "Rod equipped");
          screen = await renderRods(repo, userId, chatId);
          answerText = "Удочка экипирована.";
        } else {
          screen = await renderRodDetail(repo, userId, chatId, rod, "Эта удочка не куплена.");
        }
        break;
      }
    }
    await ctx.editEphemeralMessageText(screen.text, { reply_markup: screen.keyboard });
    await ctx.answerCallbackQuery(answerText === undefined ? undefined : { text: answerText });
  });
}
