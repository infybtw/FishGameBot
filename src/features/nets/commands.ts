import { InlineKeyboard, type Bot, type Context } from "grammy";
import type { BotContext } from "../../bot.ts";
import { isGroup } from "../../guards.ts";
import type { CatchInsert, Repo } from "../../db/index.ts";
import { randomInt } from "../../lib/random.ts";
import { escapeHtml } from "../../lib/format.ts";
import { log } from "../../logger.ts";
import { getCatalog, type Catalog } from "../fishing/catalog.ts";
import { formatRemaining } from "../fishing/cooldown.ts";
import { generateCatch, rollPoint, type CaughtFish } from "../fishing/generator.ts";
import { buildNetCallbackData, parseNetCallbackData } from "./callback-data.ts";
import { NET_DURATION_SECONDS, NET_RARITY_WEIGHTS } from "./net.ts";

const FOREIGN_MENU_ALERT = "Это меню принадлежит другому игроку.";
const STALE_MENU_ALERT = "Кнопка устарела. Откройте /net заново.";
const MENU_TITLE = "🎣 <b>Рыбацкая сеть</b>";
const NET_CATALOG_EMPTY_ALERT = "Сейчас нельзя забрать сеть: в списке рыб нет подходящих рыб.";
const ALREADY_COLLECTED_ANSWER = "Сеть уже забрана.";
const CAST_ANSWER = "Сеть заброшена. Улов будет готов через 12 часов.";

type Screen = { text: string; keyboard: InlineKeyboard };

function availableScreen(ownerUserId: number, notice?: string): Screen {
  const text =
    `${MENU_TITLE}\n\n` +
    "У каждого игрока в этом чате есть базовая сеть.\n" +
    "Заброшенная сеть приносит улов через 12 часов." +
    (notice === undefined ? "" : `\n\n${notice}`);
  return {
    text,
    keyboard: new InlineKeyboard().text("Закинуть сеть", buildNetCallbackData(ownerUserId, { kind: "cast" })),
  };
}

function activeScreen(ownerUserId: number, secondsLeft: number): Screen {
  return {
    text: `${MENU_TITLE}\n\nСеть заброшена. Улов будет готов через:\n<b>${formatRemaining(secondsLeft)}</b>`,
    keyboard: new InlineKeyboard().text("Забрать сеть", buildNetCallbackData(ownerUserId, { kind: "collect" })),
  };
}

function readyScreen(ownerUserId: number): Screen {
  return {
    text: `${MENU_TITLE}\n\n🪢 Сеть готова! Можно забрать улов.`,
    keyboard: new InlineKeyboard().text("Забрать сеть", buildNetCallbackData(ownerUserId, { kind: "collect" })),
  };
}

/** Draws the menu for the net's current state, falling back to the implicit available net. */
async function renderScreen(repo: Repo, ownerUserId: number, chatId: number, notice?: string): Promise<Screen> {
  const net = await repo.getFishingNet(ownerUserId, chatId);
  if (net === null) return availableScreen(ownerUserId, notice);
  const secondsLeft = net.castAt + NET_DURATION_SECONDS - Date.now() / 1000;
  if (secondsLeft > 0) return activeScreen(ownerUserId, secondsLeft);
  return readyScreen(ownerUserId);
}

function collectList(catches: readonly CaughtFish[]): string {
  return catches.map((fish) => `${escapeHtml(fish.name)} (${escapeHtml(fish.rarity)})`).join(", ");
}

/** Net catches ignore rods, cooldowns, chance-ups, success chance, and curses. */
function generateNetCatches(catalog: Catalog, catcherFirstName: string): CaughtFish[] {
  const count = randomInt(1, 6);
  const catches: CaughtFish[] = [];
  for (let i = 0; i < count; i++) {
    catches.push(generateCatch(catalog, rollPoint(catalog, 0, Math.random, NET_RARITY_WEIGHTS), catcherFirstName));
  }
  return catches;
}

function toCatchInserts(userId: number, chatId: number, catches: readonly CaughtFish[]): CatchInsert[] {
  return catches.map((fish) => ({
    username: fish.catcherFirstName,
    userId,
    chatId,
    fishName: fish.name,
    rarity: fish.rarity,
    point: fish.point,
    sizeCm: fish.sizeCm,
    weightG: fish.weightG,
    price: fish.price,
  }));
}

async function answerStale(ctx: Context, userId: number | undefined, chatId: number | undefined, reason: string): Promise<void> {
  log.info({ userId, chatId, reason }, "Stale net callback rejected");
  await ctx.answerCallbackQuery({ text: STALE_MENU_ALERT, show_alert: true });
}

async function editScreen(ctx: Context, screen: Screen): Promise<void> {
  await ctx.editEphemeralMessageText(screen.text, { reply_markup: screen.keyboard });
}

export function registerNetCommands(bot: Bot<BotContext>, repo: Repo): void {
  bot.command("net", async (ctx) => {
    if (!isGroup(ctx) || ctx.from === undefined) {
      log.debug({ userId: ctx.from?.id, chatId: ctx.chat?.id }, "/net ignored outside groups");
      return;
    }
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    // A player who has never used /fish still needs a fisher row to own net fish.
    await repo.ensureFisher(userId, chatId, ctx.from.first_name);
    const screen = await renderScreen(repo, userId, chatId);
    log.debug({ userId, chatId }, "Net menu opened");
    await ctx.api.sendMessage(chatId, screen.text, {
      reply_markup: screen.keyboard,
      ephemeral_message_parameters: { receiver_user_id: userId },
    });
    await ctx.deleteMessage();
  });

  bot.callbackQuery(/^net:/, async (ctx) => {
    const parsed = parseNetCallbackData(ctx.callbackQuery.data);
    if (parsed === null || ctx.from === undefined) {
      await answerStale(ctx, ctx.from?.id, ctx.chat?.id, "malformed callback or missing sender");
      return;
    }
    if (parsed.ownerUserId !== ctx.from.id) {
      log.warn({ userId: ctx.from.id, chatId: ctx.chat?.id, ownerUserId: parsed.ownerUserId }, "Foreign net callback rejected");
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
    const firstName = ctx.from.first_name;

    if (parsed.action.kind === "cast") {
      const castAt = Date.now() / 1000;
      await repo.castFishingNet(userId, chatId, firstName, castAt);
      log.info({ userId, chatId, castAt }, "Fishing net cast");
      await editScreen(ctx, await renderScreen(repo, userId, chatId));
      await ctx.answerCallbackQuery({ text: CAST_ANSWER });
      return;
    }

    // Collection reads the row first so a stale press redraws instead of mutating.
    const net = await repo.getFishingNet(userId, chatId);
    if (net === null) {
      log.info({ userId, chatId }, "Stale net collection: net already collected");
      await editScreen(ctx, await renderScreen(repo, userId, chatId));
      await ctx.answerCallbackQuery({ text: ALREADY_COLLECTED_ANSWER });
      return;
    }
    const now = Date.now() / 1000;
    const secondsLeft = net.castAt + NET_DURATION_SECONDS - now;
    if (secondsLeft > 0) {
      log.info({ userId, chatId, castAt: net.castAt, secondsLeft }, "Early net collection rejected");
      await ctx.answerCallbackQuery({ text: `Ещё нельзя забрать сеть. Осталось: ${formatRemaining(secondsLeft)}.`, show_alert: true });
      return;
    }

    let catches: CaughtFish[];
    try {
      catches = generateNetCatches(getCatalog(), firstName);
    } catch {
      // No template carries a positive net weight: keep the net cast.
      log.warn({ userId, chatId }, "Net collection blocked: no eligible catalog templates");
      await ctx.answerCallbackQuery({ text: NET_CATALOG_EMPTY_ALERT, show_alert: true });
      return;
    }
    const result = await repo.collectFishingNet(userId, chatId, now, toCatchInserts(userId, chatId, catches));
    if (result.status === "not_ready") {
      // A concurrent callback won the row; repeat the early answer without granting fish.
      const racedSecondsLeft = result.castAt + NET_DURATION_SECONDS - now;
      log.info({ userId, chatId, castAt: result.castAt, secondsLeft: racedSecondsLeft }, "Raced net collection lost");
      await ctx.answerCallbackQuery({ text: `Ещё нельзя забрать сеть. Осталось: ${formatRemaining(racedSecondsLeft)}.`, show_alert: true });
      return;
    }
    if (result.status === "not_cast") {
      log.info({ userId, chatId }, "Raced net collection found no net");
      await editScreen(ctx, await renderScreen(repo, userId, chatId));
      await ctx.answerCallbackQuery({ text: ALREADY_COLLECTED_ANSWER });
      return;
    }

    log.info(
      { userId, chatId, castAt: result.castAt, count: catches.length, points: catches.map((fish) => fish.point) },
      "Fishing net collected",
    );
    await editScreen(ctx, await renderScreen(repo, userId, chatId, `Улов из сети: ${collectList(catches)}.`));
    await ctx.answerCallbackQuery({ text: `Сеть забрана: ${catches.length} шт.` });
  });
}

