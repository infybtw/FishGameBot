import { InlineKeyboard, type Bot, type Context } from "grammy";
import { createConversation } from "@grammyjs/conversations";
import type { BotContext, FishConversation } from "../../bot.ts";
import type { InventoryPage, Repo, TradeRow } from "../../db/index.ts";
import { isGroup, replyTarget } from "../../guards.ts";
import { log } from "../../logger.ts";
import { round2 } from "../../lib/format.ts";
import {
  buildMenuCallbackData,
  buildPublicCallbackData,
  parseMenuCallbackData,
  parsePublicCallbackData,
  type TradeMenuAction,
} from "./callback-data.ts";
import {
  INITIATOR_FISH_EMPTY,
  MONEY_INVALID,
  MONEY_PROMPT_PREFIX,
  TRADE_DECLINED,
  TRADE_DONE,
  TRADE_UNAVAILABLE,
  TRADE_USAGE,
  initiatorFishCard,
  targetFishCard,
  targetFishEmpty,
  tradeMenu,
  tradeOfferCard,
} from "./messages.ts";

/** Mirrors /profile's inventory page size. */
const PAGE_SIZE = 5;
const FOREIGN_MENU_ALERT = "Это меню принадлежит другому игроку.";
const STALE_MENU_ALERT = "Кнопка устарела. Откройте /trade заново.";
const FOREIGN_TRADE_ALERT = "Этот обмен адресован не вам.";
const OFFER_STALE_ANSWER = "Выбранная рыба уже недоступна.";
const OFFER_PUBLISHED_ANSWER = "Предложение отправлено.";
const MONEY_PROMPT_TAIL = "Например: 150 или 99.99";

type Screen = { text: string; keyboard: InlineKeyboard };

/** A finite positive decimal with at most two fractional digits; comma or dot. */
export function parseMoneyAmount(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return round2(value);
}

function logIgnored(ctx: Context, reason: string): void {
  log.debug({ command: "/trade", userId: ctx.from?.id, chatId: ctx.chat?.id, reason }, "Command ignored");
}

async function answerStale(ctx: Context, userId: number | undefined, chatId: number | undefined, reason: string): Promise<void> {
  log.info({ userId, chatId, reason }, "Stale trade callback rejected");
  await ctx.answerCallbackQuery({ text: STALE_MENU_ALERT, show_alert: true });
}

/** The replied-to player's display name; players without a fisher row have nothing to trade. */
async function targetFirstName(repo: Repo, targetUserId: number, chatId: number): Promise<string> {
  const fisher = await repo.getFisher(targetUserId, chatId);
  return fisher?.firstName ?? "игрок";
}

function menuScreen(ownerUserId: number, targetUserId: number, targetName: string): Screen {
  return {
    text: tradeMenu(targetUserId, targetName),
    keyboard: new InlineKeyboard()
      .text("Обменять рыбу", buildMenuCallbackData(ownerUserId, targetUserId, { kind: "initiatorFish", page: 1 }))
      .row()
      .text("Заплатить деньгами", buildMenuCallbackData(ownerUserId, targetUserId, { kind: "targetFishMoney", page: 1 })),
  };
}

function inventoryKeyboard(
  ownerUserId: number,
  targetUserId: number,
  inventory: InventoryPage,
  fishAction: (fishId: number) => TradeMenuAction,
  pageAction: (page: number) => TradeMenuAction,
  backData: string,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const fish of inventory.fishes) {
    keyboard.text(`#${fish.id} ${fish.name}`, buildMenuCallbackData(ownerUserId, targetUserId, fishAction(fish.id))).row();
  }
  if (inventory.page > 1) keyboard.text("←", buildMenuCallbackData(ownerUserId, targetUserId, pageAction(inventory.page - 1)));
  if (inventory.page * PAGE_SIZE < inventory.totalCount) {
    keyboard.text("→", buildMenuCallbackData(ownerUserId, targetUserId, pageAction(inventory.page + 1)));
  }
  if (inventory.page > 1 || inventory.page * PAGE_SIZE < inventory.totalCount) keyboard.row();
  return keyboard.text("Назад", backData);
}

async function renderInitiatorFish(
  repo: Repo,
  ownerUserId: number,
  targetUserId: number,
  chatId: number,
  page: number,
): Promise<Screen> {
  const inventory = await repo.getInventoryPage(ownerUserId, chatId, page, PAGE_SIZE);
  if (inventory.totalCount === 0) {
    return { text: INITIATOR_FISH_EMPTY, keyboard: new InlineKeyboard().text("Назад", buildMenuCallbackData(ownerUserId, targetUserId, { kind: "menu" })) };
  }
  return {
    text: initiatorFishCard(inventory),
    keyboard: inventoryKeyboard(
      ownerUserId,
      targetUserId,
      inventory,
      (fishId) => ({ kind: "pickInitiatorFish", fishId }),
      (nextPage) => ({ kind: "initiatorFish", page: nextPage }),
      buildMenuCallbackData(ownerUserId, targetUserId, { kind: "menu" }),
    ),
  };
}

async function renderTargetFish(
  repo: Repo,
  ownerUserId: number,
  targetUserId: number,
  targetName: string,
  chatId: number,
  offeredFishId: number,
  page: number,
): Promise<Screen> {
  const inventory = await repo.getInventoryPage(targetUserId, chatId, page, PAGE_SIZE);
  if (inventory.totalCount === 0) {
    return {
      text: targetFishEmpty(targetUserId, targetName),
      keyboard: new InlineKeyboard().text("Назад", buildMenuCallbackData(ownerUserId, targetUserId, { kind: "initiatorFish", page: 1 })),
    };
  }
  return {
    text: targetFishCard(targetUserId, targetName, inventory),
    keyboard: inventoryKeyboard(
      ownerUserId,
      targetUserId,
      inventory,
      (fishId) => ({ kind: "pickTargetFish", offeredFishId, fishId }),
      (nextPage) => ({ kind: "targetFish", offeredFishId, page: nextPage }),
      buildMenuCallbackData(ownerUserId, targetUserId, { kind: "initiatorFish", page: 1 }),
    ),
  };
}

async function renderTargetFishMoney(
  repo: Repo,
  ownerUserId: number,
  targetUserId: number,
  targetName: string,
  chatId: number,
  page: number,
): Promise<Screen> {
  const inventory = await repo.getInventoryPage(targetUserId, chatId, page, PAGE_SIZE);
  if (inventory.totalCount === 0) {
    return {
      text: targetFishEmpty(targetUserId, targetName),
      keyboard: new InlineKeyboard().text("Назад", buildMenuCallbackData(ownerUserId, targetUserId, { kind: "menu" })),
    };
  }
  return {
    text: targetFishCard(targetUserId, targetName, inventory),
    keyboard: inventoryKeyboard(
      ownerUserId,
      targetUserId,
      inventory,
      (fishId) => ({ kind: "pickTargetFishMoney", fishId }),
      (nextPage) => ({ kind: "targetFishMoney", page: nextPage }),
      buildMenuCallbackData(ownerUserId, targetUserId, { kind: "menu" }),
    ),
  };
}

function offerKeyboard(tradeId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("Принять", buildPublicCallbackData(tradeId, { kind: "accept" }))
    .text("Отклонить", buildPublicCallbackData(tradeId, { kind: "decline" }));
}

function logOfferCreated(trade: TradeRow): void {
  log.info(
    {
      tradeId: trade.id,
      chatId: trade.chatId,
      initiatorUserId: trade.initiatorUserId,
      targetUserId: trade.targetUserId,
      offeredFishId: trade.offer.kind === "fish" ? trade.offer.fish.id : undefined,
      offeredMoney: trade.offer.kind === "money" ? trade.offer.amount : undefined,
      requestedFishId: trade.requestedFish?.id,
    },
    "Trade offer created",
  );
}

async function publishOffer(ctx: Context, trade: TradeRow): Promise<void> {
  await ctx.api.sendMessage(trade.chatId, tradeOfferCard(trade), { reply_markup: offerKeyboard(trade.id) });
  logOfferCreated(trade);
}

function tradeMoneyConversation(repo: Repo) {
  return async (
    conversation: FishConversation,
    ctx: Context,
    initiatorId: number,
    chatId: number,
    targetUserId: number,
    targetName: string,
    requestedFishId: number,
  ): Promise<void> => {
  // The whole amount dialog stays initiator-bound; only the published offer is public.
  const toInitiator = { ephemeral_message_parameters: { receiver_user_id: initiatorId } };
  await ctx.api.sendMessage(chatId, `${MONEY_PROMPT_PREFIX} ${targetName}. ${MONEY_PROMPT_TAIL}`, toInitiator);
  for (;;) {
    const received = await conversation.waitUntil(
      (c) => c.from?.id === initiatorId && c.chat?.id === chatId && typeof c.message?.text === "string",
      // Keep the group alive: updates from other players flow to normal handlers.
      { next: true },
    );
    const amount = parseMoneyAmount(received.message!.text!);
    if (amount === null) {
      await received.api.sendMessage(chatId, MONEY_INVALID, toInitiator);
      continue;
    }
    // external() runs the repository write once; replays reuse the cached result.
    const result = await conversation.external(() =>
      repo.createTrade({
        chatId,
        initiatorUserId: initiatorId,
        initiatorFirstName: ctx.from?.first_name ?? "игрок",
        targetUserId,
        targetFirstName: targetName,
        offer: { kind: "money", amount },
        requestedFishId,
      }),
    );
    if (result.status === "stale") {
      log.info({ initiatorUserId: initiatorId, targetUserId, chatId, requestedFishId }, "Stale money trade rejected");
      await received.api.sendMessage(chatId, OFFER_STALE_ANSWER, toInitiator);
      return;
    }
    // Conversation contexts build their own Api client, which lacks the
    // bot-level default parse_mode transformer — set HTML explicitly.
    await received.api.sendMessage(chatId, tradeOfferCard(result.trade), {
      reply_markup: offerKeyboard(result.trade.id),
      parse_mode: "HTML",
    });
    logOfferCreated(result.trade);
    return;
  }
  };
}

export function registerTradeCommands(bot: Bot<BotContext>, repo: Repo): void {
  bot.use(createConversation(tradeMoneyConversation(repo), "tradeMoney"));

  bot.command("trade", async (ctx) => {
    if (!isGroup(ctx) || ctx.from === undefined) {
      logIgnored(ctx, "not a group chat or sender unknown");
      return;
    }
    const target = replyTarget(ctx);
    if (target === null || target.id === ctx.from.id) {
      logIgnored(ctx, target === null ? "not a reply to another player" : "reply to self");
      await ctx.reply(TRADE_USAGE);
      return;
    }
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    await repo.ensureFisher(userId, chatId, ctx.from.first_name);
    const targetName = await targetFirstName(repo, target.id, chatId);
    const screen = menuScreen(userId, target.id, targetName);
    log.info({ userId, chatId, targetUserId: target.id }, "Trade menu opened");
    await ctx.api.sendMessage(chatId, screen.text, {
      reply_markup: screen.keyboard,
      ephemeral_message_parameters: { receiver_user_id: userId },
    });
    await ctx.deleteMessage();
  });

  bot.callbackQuery(/^tr:/, async (ctx) => {
    const parsed = parseMenuCallbackData(ctx.callbackQuery.data);
    if (parsed === null || ctx.from === undefined) {
      await answerStale(ctx, ctx.from?.id, ctx.chat?.id, "malformed callback or missing sender");
      return;
    }
    if (parsed.ownerUserId !== ctx.from.id) {
      log.warn({ userId: ctx.from.id, chatId: ctx.chat?.id, ownerUserId: parsed.ownerUserId }, "Foreign trade menu callback rejected");
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
    const targetId = parsed.targetUserId;
    const action = parsed.action;

    if (action.kind === "pickTargetFish") {
      const targetName = await targetFirstName(repo, targetId, chatId);
      const result = await repo.createTrade({
        chatId,
        initiatorUserId: userId,
        initiatorFirstName: ctx.from.first_name,
        targetUserId: targetId,
        targetFirstName: targetName,
        offer: { kind: "fish", offeredFishId: action.offeredFishId },
        requestedFishId: action.fishId,
      });
      if (result.status === "stale") {
        log.info({ userId, chatId, targetUserId: targetId, offeredFishId: action.offeredFishId, requestedFishId: action.fishId }, "Stale trade creation rejected");
        await ctx.answerCallbackQuery({ text: OFFER_STALE_ANSWER, show_alert: true });
        return;
      }
      await publishOffer(ctx, result.trade);
      await ctx.answerCallbackQuery({ text: OFFER_PUBLISHED_ANSWER });
      return;
    }

    if (action.kind === "pickTargetFishMoney") {
      const targetName = await targetFirstName(repo, targetId, chatId);
      await ctx.conversation.enter("tradeMoney", userId, chatId, targetId, targetName, action.fishId);
      await ctx.answerCallbackQuery();
      return;
    }

    let screen: Screen;
    switch (action.kind) {
      case "menu":
        screen = menuScreen(userId, targetId, await targetFirstName(repo, targetId, chatId));
        break;
      case "initiatorFish":
        screen = await renderInitiatorFish(repo, userId, targetId, chatId, action.page);
        break;
      case "pickInitiatorFish":
        screen = await renderTargetFish(repo, userId, targetId, await targetFirstName(repo, targetId, chatId), chatId, action.fishId, 1);
        break;
      case "targetFish":
        screen = await renderTargetFish(repo, userId, targetId, await targetFirstName(repo, targetId, chatId), chatId, action.offeredFishId, action.page);
        break;
      case "targetFishMoney":
        screen = await renderTargetFishMoney(repo, userId, targetId, await targetFirstName(repo, targetId, chatId), chatId, action.page);
        break;
    }
    await ctx.editEphemeralMessageText(screen.text, { reply_markup: screen.keyboard });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^trd:/, async (ctx) => {
    const parsed = parsePublicCallbackData(ctx.callbackQuery.data);
    if (parsed === null || ctx.from === undefined) {
      log.info({ userId: ctx.from?.id, chatId: ctx.chat?.id, tradeId: undefined }, "Malformed public trade callback rejected");
      await ctx.answerCallbackQuery({ text: STALE_MENU_ALERT, show_alert: true });
      return;
    }
    const chatId = ctx.chat?.id;
    const trade = await repo.getTrade(parsed.tradeId);
    // The persisted row authorizes the press: wrong chat or wrong player never mutates.
    if (chatId === undefined || trade === null || trade.chatId !== chatId || trade.targetUserId !== ctx.from.id) {
      log.warn({ userId: ctx.from.id, chatId, tradeId: parsed.tradeId }, "Foreign public trade callback rejected");
      await ctx.answerCallbackQuery({ text: FOREIGN_TRADE_ALERT, show_alert: true });
      return;
    }
    if (trade.status !== "pending") {
      // Replayed press on an already resolved offer: answer without editing.
      const outcome = trade.status === "accepted" ? TRADE_DONE : trade.status === "declined" ? TRADE_DECLINED : TRADE_UNAVAILABLE;
      log.info({ userId: ctx.from.id, chatId, tradeId: parsed.tradeId, status: trade.status }, "Resolved trade callback re-answered");
      await ctx.answerCallbackQuery({ text: outcome });
      return;
    }
    const result =
      parsed.action.kind === "accept"
        ? await repo.acceptTrade(parsed.tradeId, ctx.from.id, chatId)
        : await repo.declineTrade(parsed.tradeId, ctx.from.id, chatId);
    const text = result.status === "accepted" ? TRADE_DONE : result.status === "declined" ? TRADE_DECLINED : TRADE_UNAVAILABLE;
    log.info(
      {
        tradeId: parsed.tradeId,
        chatId,
        initiatorUserId: trade.initiatorUserId,
        targetUserId: trade.targetUserId,
        offeredFishId: trade.offer.kind === "fish" ? trade.offer.fish.id : undefined,
        offeredMoney: trade.offer.kind === "money" ? trade.offer.amount : undefined,
        requestedFishId: trade.requestedFish?.id,
        result: result.status,
      },
      "Trade resolved",
    );
    await ctx.editMessageText(text);
    await ctx.answerCallbackQuery();
  });
}
