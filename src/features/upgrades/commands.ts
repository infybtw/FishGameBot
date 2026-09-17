import { InlineKeyboard, type Bot, type Context } from "grammy";
import type { BotContext } from "../../bot.ts";
import type { Config } from "../../config.ts";
import type { EquipResult, PurchaseResult, RarityInventorySummary, Repo, SaleResult } from "../../db/index.ts";
import { isGroup } from "../../guards.ts";
import { log } from "../../logger.ts";
import { aggregateCollectionBuffs } from "../collections/catalog.ts";
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
  rodCaseResultCard,
  rodCasesCard,
  rodsCard,
  reforgeCard,
} from "./messages.ts";
import { getRod, RODS, type RodDefinition, type RodId } from "./rods.ts";
import { getReforge, rollReforge } from "./reforges.ts";
import { ROD_CASES, getRodCase, rollCaseRod } from "../rod-cases/catalog.ts";

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
    .text("🎣 Удочки", buildCallbackData(ownerUserId, { kind: "rods" }))
    .row()
    .text("📦 Кейсы", buildCallbackData(ownerUserId, { kind: "cases" }));
}

async function renderHome(repo: Repo, cfg: Config, userId: number, chatId: number): Promise<Screen> {
  const [fisher, inventory, equippedId, completedCollectionIds] = await Promise.all([
    repo.getFisher(userId, chatId),
    repo.getInventoryPage(userId, chatId, 1, PAGE_SIZE),
    repo.getEquippedRodId(userId, chatId),
    repo.listCompletedCollectionIds(userId, chatId),
  ]);
  if (fisher === null) throw new Error("Profile rendering requires an existing fisher");
  const rod = getRod(equippedId ?? "basic") ?? getRod("basic")!;
  return {
    text: profileCard(
      fisher.balance,
      rod,
      cfg.catchSuccessChance,
      inventory.totalCount,
      inventory.totalValue,
      aggregateCollectionBuffs(completedCollectionIds),
    ),
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

async function renderCases(repo: Repo, userId: number, chatId: number): Promise<Screen> {
  const [fisher, balances] = await Promise.all([repo.getFisher(userId, chatId), repo.listRodCaseBalances(userId, chatId)]);
  if (fisher === null) throw new Error("Case rendering requires an existing fisher");
  const quantities = new Map(balances.map((balance) => [balance.caseId, balance.quantity]));
  const cases = ROD_CASES.map((case_) => ({ case: case_, quantity: quantities.get(case_.id) ?? 0 }));
  const keyboard = new InlineKeyboard();
  for (const { case: case_, quantity } of cases) {
    keyboard.text(`Купить ${case_.name}`, buildCallbackData(userId, { kind: "casebuy", caseId: case_.id }));
    if (quantity > 0) keyboard.text(`Открыть (${quantity})`, buildCallbackData(userId, { kind: "caseopen", caseId: case_.id }));
    keyboard.row();
  }
  keyboard.text("Назад", buildCallbackData(userId, { kind: "home" }));
  return { text: rodCasesCard(fisher.balance, cases), keyboard };
}

async function renderRodDetail(
  repo: Repo,
  userId: number,
  chatId: number,
  rod: RodDefinition,
  notice?: string,
): Promise<Screen> {
  const [context, reforgeId] = await Promise.all([rodContext(repo, userId, chatId), repo.getRodReforgeId(userId, chatId, rod.id)]);
  const state = rodState(rod.id, context.equippedRodId, context.purchasedRodIds);
  const unavailablePoints = new Set<number>();
  const catalog = getCatalog();
  for (const requirement of rod.acquisition === "shop" ? rod.recipe : []) {
    if (catalog[requirement.point - 1]?.length !== undefined && catalog[requirement.point - 1]!.length === 0) {
      unavailablePoints.add(requirement.point);
    }
    if (catalog[requirement.point - 1] === undefined) unavailablePoints.add(requirement.point);
  }
  const keyboard = new InlineKeyboard();
  if (state === "Куплена") keyboard.text("Экипировать", buildCallbackData(userId, { kind: "equip", rodId: rod.id })).row();
  if (state === "Не куплена" && rod.acquisition === "shop") keyboard.text("Купить и экипировать", buildCallbackData(userId, { kind: "buy", rodId: rod.id })).row();
  if (state !== "Не куплена") keyboard.text("🔨 Перековать", buildCallbackData(userId, { kind: "reforge", rodId: rod.id, page: 1 })).row();
  keyboard.text("Назад", buildCallbackData(userId, { kind: "rods" }));
  const text = rodDetailCard(rod, state, context.balance, context.inventory, unavailablePoints, getReforge(reforgeId));
  return { text: notice === undefined ? text : `${text}\n\n⚠️ ${notice}`, keyboard };
}

async function renderReforge(repo: Repo, userId: number, chatId: number, rod: RodDefinition, page: number): Promise<Screen> {
  const inventory = await repo.getInventoryPage(userId, chatId, page, PAGE_SIZE);
  const keyboard = new InlineKeyboard();
  for (const fish of inventory.fishes) keyboard.text(`Использовать #${fish.id}`, buildCallbackData(userId, { kind: "reforgeapply", rodId: rod.id, fishId: fish.id })).row();
  if (inventory.page > 1) keyboard.text("←", buildCallbackData(userId, { kind: "reforge", rodId: rod.id, page: inventory.page - 1 }));
  if (inventory.page * PAGE_SIZE < inventory.totalCount) keyboard.text("→", buildCallbackData(userId, { kind: "reforge", rodId: rod.id, page: inventory.page + 1 }));
  if (inventory.page > 1 || inventory.page * PAGE_SIZE < inventory.totalCount) keyboard.row();
  keyboard.text("Назад", buildCallbackData(userId, { kind: "rod", rodId: rod.id }));
  return { text: reforgeCard(rod, inventory), keyboard };
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
      case "cases":
        screen = await renderCases(repo, userId, chatId);
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
        if (rod === undefined || rod.id === "basic" || rod.acquisition !== "shop") {
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
      case "reforge": {
        const rod = getRod(parsed.action.rodId);
        if (rod === undefined) { await answerStale(ctx, userId, chatId, "unknown reforge rod"); return; }
        screen = await renderReforge(repo, userId, chatId, rod, parsed.action.page);
        break;
      }
      case "reforgeapply": {
        const rod = getRod(parsed.action.rodId);
        if (rod === undefined) { await answerStale(ctx, userId, chatId, "unknown reforge rod"); return; }
        const result = await repo.reforgeRod(userId, chatId, rod.id, parsed.action.fishId, (point) => rollReforge(point)?.id ?? null);
        if (result.status === "reforged") {
          const reforge = getReforge(result.modifierId)!;
          log.info({ userId, chatId, rodId: rod.id, fishId: result.source.id, point: result.source.point, modifierId: reforge.id }, "Rod reforged");
          screen = await renderRodDetail(repo, userId, chatId, rod, `Получен эффект «${reforge.name}»: ${reforge.description}`);
          answerText = "Удочка перекована.";
        } else if (result.status === "not_owned") {
          screen = await renderRods(repo, userId, chatId);
          answerText = "Эта удочка вам не принадлежит.";
        } else {
          screen = await renderReforge(repo, userId, chatId, rod, 1);
          answerText = "Рыба уже недоступна.";
        }
        break;
      }
      case "casebuy": {
        const case_ = getRodCase(parsed.action.caseId);
        if (case_ === undefined) { await answerStale(ctx, userId, chatId, "unknown rod case purchase"); return; }
        const result = await repo.buyRodCase(userId, chatId, case_.id, case_.price);
        screen = await renderCases(repo, userId, chatId);
        answerText = result.status === "purchased" ? "Кейс куплен." : `Не хватает средств: нужно ${money(result.required)}, доступно ${money(result.available)}.`;
        break;
      }
      case "caseopen": {
        const case_ = getRodCase(parsed.action.caseId);
        if (case_ === undefined) { await answerStale(ctx, userId, chatId, "unknown rod case opening"); return; }
        const rod = rollCaseRod(case_.id, Math.random);
        const result = await repo.openRodCase(userId, chatId, case_.id, rod.id, rod.duplicateCompensation);
        if (result.status === "no_case") { screen = await renderCases(repo, userId, chatId); answerText = "Кейс уже открыт или недоступен."; break; }
        log.info({ userId, chatId, caseId: case_.id, rodId: rod.id, rarity: rod.rarity, duplicate: result.duplicate, compensation: result.compensation }, "Rod case opened");
        screen = { text: rodCaseResultCard(case_, rod, result.duplicate, result.compensation), keyboard: new InlineKeyboard().text("🎣 К удочкам", buildCallbackData(userId, { kind: "rods" })).row().text("📦 К кейсам", buildCallbackData(userId, { kind: "cases" })) };
        break;
      }
    }
    await ctx.editEphemeralMessageText(screen.text, { reply_markup: screen.keyboard });
    await ctx.answerCallbackQuery(answerText === undefined ? undefined : { text: answerText });
  });
}
