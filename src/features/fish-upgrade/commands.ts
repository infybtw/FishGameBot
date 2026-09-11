import { InlineKeyboard, type Bot, type Context } from "grammy";
import type { BotContext } from "../../bot.ts";
import type { InventoryPage, Repo, UpgradeFishResult } from "../../db/index.ts";
import { isGroup } from "../../guards.ts";
import { log } from "../../logger.ts";
import { getCatalog } from "../fishing/catalog.ts";
import { generateCatch } from "../fishing/generator.ts";
import { buildFishUpgradeCallbackData, parseFishUpgradeCallbackData } from "./callback-data.ts";
import { didUpgradeSucceed, upgradeChanceFor } from "./chances.ts";
import {
  FISH_UPGRADE_EMPTY,
  FISH_UPGRADE_FAILURE_ANSWER,
  FISH_UPGRADE_FOREIGN,
  FISH_UPGRADE_MAX_RARITY_ANSWER,
  FISH_UPGRADE_STALE,
  FISH_UPGRADE_SUCCESS_ANSWER,
  FISH_UPGRADE_TARGET_MISSING_ANSWER,
  FISH_UPGRADE_UNAVAILABLE,
  FISH_UPGRADE_UNAVAILABLE_ANSWER,
  fishButtonLabel,
  upgradeConfirmCard,
  upgradeFailureCard,
  upgradeMaxRarityCard,
  upgradeMenuCard,
  upgradeSuccessCard,
  upgradeTargetMissingCard,
} from "./messages.ts";

/** Mirrors /profile's inventory page size. */
const PAGE_SIZE = 5;

type Screen = { text: string; keyboard?: InlineKeyboard };

function logIgnored(ctx: Context, reason: string): void {
  log.debug({ command: "/fish_upgrade", userId: ctx.from?.id, chatId: ctx.chat?.id, reason }, "Command ignored");
}

async function answerStale(ctx: Context, userId: number | undefined, chatId: number | undefined, reason: string): Promise<void> {
  log.info({ userId, chatId, reason }, "Stale fish upgrade callback rejected");
  await ctx.answerCallbackQuery({ text: FISH_UPGRADE_STALE, show_alert: true });
}

function backToList(ownerUserId: number): InlineKeyboard {
  return new InlineKeyboard().text("← К списку", buildFishUpgradeCallbackData(ownerUserId, { kind: "list", page: 1 }));
}

function listKeyboard(ownerUserId: number, inventory: InventoryPage): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  inventory.fishes.forEach((fish, index) => {
    if (index > 0) keyboard.row();
    keyboard.text(fishButtonLabel(fish), buildFishUpgradeCallbackData(ownerUserId, { kind: "confirm", fishId: fish.id }));
  });
  if (inventory.page > 1 || inventory.page * PAGE_SIZE < inventory.totalCount) {
    keyboard.row();
    if (inventory.page > 1) keyboard.text("←", buildFishUpgradeCallbackData(ownerUserId, { kind: "list", page: inventory.page - 1 }));
    if (inventory.page * PAGE_SIZE < inventory.totalCount) {
      keyboard.text("→", buildFishUpgradeCallbackData(ownerUserId, { kind: "list", page: inventory.page + 1 }));
    }
  }
  return keyboard;
}

async function renderList(repo: Repo, ownerUserId: number, chatId: number, page: number): Promise<Screen> {
  const inventory = await repo.getInventoryPage(ownerUserId, chatId, page, PAGE_SIZE);
  if (inventory.totalCount === 0) return { text: FISH_UPGRADE_EMPTY };
  return { text: upgradeMenuCard(inventory), keyboard: listKeyboard(ownerUserId, inventory) };
}

/**
 * The menu is a public group message, but only the owner's presses carry a
 * matching owner ID, so other players can watch yet never operate it.
 */
function confirmKeyboard(ownerUserId: number, fishId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("🎣 Улучшить", buildFishUpgradeCallbackData(ownerUserId, { kind: "apply", fishId }))
    .row()
    .text("← К списку", buildFishUpgradeCallbackData(ownerUserId, { kind: "list", page: 1 }));
}

async function renderConfirm(repo: Repo, ownerUserId: number, chatId: number, fishId: number): Promise<Screen> {
  const fish = await repo.getAvailableCatch(ownerUserId, chatId, fishId);
  if (fish === null) return { text: FISH_UPGRADE_UNAVAILABLE, keyboard: backToList(ownerUserId) };
  const chance = upgradeChanceFor(fish.point);
  if (chance === null) return { text: upgradeMaxRarityCard(fish), keyboard: backToList(ownerUserId) };
  const targetGroup = getCatalog()[fish.point] ?? [];
  if (targetGroup.length === 0) return { text: upgradeTargetMissingCard(fish), keyboard: backToList(ownerUserId) };
  return {
    text: upgradeConfirmCard(fish, chance, targetGroup[0]!.rarity),
    keyboard: confirmKeyboard(ownerUserId, fishId),
  };
}

/** The three rejected statuses keep a way back; resolved ones leave no active retry buttons. */
function resultScreen(result: UpgradeFishResult, ownerUserId: number): Screen {
  switch (result.status) {
    case "upgraded":
      return { text: upgradeSuccessCard(result.source, result.chance, result.created) };
    case "failed":
      return { text: upgradeFailureCard(result.source, result.chance) };
    case "not_available":
      return { text: FISH_UPGRADE_UNAVAILABLE, keyboard: backToList(ownerUserId) };
    case "max_rarity":
      return { text: upgradeMaxRarityCard(result.source), keyboard: backToList(ownerUserId) };
    case "target_rarity_missing":
      return { text: upgradeTargetMissingCard(result.source), keyboard: backToList(ownerUserId) };
  }
}

function answerForResult(result: UpgradeFishResult): { text: string; show_alert: boolean } {
  switch (result.status) {
    case "upgraded":
      return { text: FISH_UPGRADE_SUCCESS_ANSWER, show_alert: false };
    case "failed":
      return { text: FISH_UPGRADE_FAILURE_ANSWER, show_alert: false };
    case "not_available":
      return { text: FISH_UPGRADE_UNAVAILABLE_ANSWER, show_alert: true };
    case "max_rarity":
      return { text: FISH_UPGRADE_MAX_RARITY_ANSWER, show_alert: true };
    case "target_rarity_missing":
      return { text: FISH_UPGRADE_TARGET_MISSING_ANSWER, show_alert: true };
  }
}

export function registerFishUpgradeCommands(bot: Bot<BotContext>, repo: Repo): void {
  bot.command("fish_upgrade", async (ctx) => {
    if (!isGroup(ctx) || ctx.from === undefined) {
      logIgnored(ctx, "not a group chat or sender unknown");
      return;
    }
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    await repo.ensureFisher(userId, chatId, ctx.from.first_name);
    const screen = await renderList(repo, userId, chatId, 1);
    log.info({ userId, chatId }, "Fish upgrade menu opened");
    await ctx.api.sendMessage(chatId, screen.text, { reply_markup: screen.keyboard });
    await ctx.deleteMessage();
  });

  bot.callbackQuery(/^fup:/, async (ctx) => {
    const parsed = parseFishUpgradeCallbackData(ctx.callbackQuery.data);
    if (parsed === null || ctx.from === undefined) {
      await answerStale(ctx, ctx.from?.id, ctx.chat?.id, "malformed callback or missing sender");
      return;
    }
    if (parsed.ownerUserId !== ctx.from.id) {
      log.warn({ userId: ctx.from.id, chatId: ctx.chat?.id, ownerUserId: parsed.ownerUserId }, "Foreign fish upgrade menu callback rejected");
      await ctx.answerCallbackQuery({ text: FISH_UPGRADE_FOREIGN, show_alert: true });
      return;
    }
    if (!isGroup(ctx) || ctx.callbackQuery.message === undefined) {
      await answerStale(ctx, ctx.from.id, ctx.chat?.id, "callback outside a group message");
      return;
    }

    const userId = ctx.from.id;
    const chatId = ctx.callbackQuery.message.chat.id;

    if (parsed.action.kind === "list") {
      const screen = await renderList(repo, userId, chatId, parsed.action.page);
      await ctx.editMessageText(screen.text, { reply_markup: screen.keyboard });
      await ctx.answerCallbackQuery();
      return;
    }

    if (parsed.action.kind === "confirm") {
      const screen = await renderConfirm(repo, userId, chatId, parsed.action.fishId);
      await ctx.editMessageText(screen.text, { reply_markup: screen.keyboard });
      await ctx.answerCallbackQuery();
      return;
    }

    const catalog = getCatalog();
    const firstName = ctx.from.first_name;
    const result = await repo.upgradeFish({
      userId,
      chatId,
      fishId: parsed.action.fishId,
      firstName,
      catalog,
      chanceForPoint: upgradeChanceFor,
      roll: (chance) => didUpgradeSucceed(chance),
      buildCatch: (targetPoint) => generateCatch(catalog, targetPoint, firstName),
    });
    log.info(
      {
        userId,
        chatId,
        fishId: parsed.action.fishId,
        result: result.status,
        sourcePoint: result.status === "not_available" ? undefined : result.source.point,
        targetPoint: result.status === "not_available" ? undefined : result.source.point + 1,
        chance: result.status === "upgraded" || result.status === "failed" ? result.chance : undefined,
        upgradedPoint: result.status === "upgraded" ? result.created.point : undefined,
      },
      "Fish upgrade attempt",
    );
    const screen = resultScreen(result, userId);
    await ctx.editMessageText(screen.text, { reply_markup: screen.keyboard });
    const answer = answerForResult(result);
    await ctx.answerCallbackQuery({ text: answer.text, show_alert: answer.show_alert });
  });
}
