import { InlineKeyboard, type Bot, type Context } from "grammy";
import type { BotContext } from "../../bot.ts";
import type { Repo } from "../../db/index.ts";
import { isGroup } from "../../guards.ts";
import { escapeHtml } from "../../lib/format.ts";
import { log } from "../../logger.ts";
import { getCatalog } from "../fishing/catalog.ts";
import { buildCollectionCallbackData, parseCollectionCallbackData } from "./callback-data.ts";
import {
  aggregateCollectionBuffs,
  COLLECTIONS,
  collectionProgress,
  collectionRequiredNames,
  getCollection,
} from "./catalog.ts";
import {
  COLLECTIONS_ALREADY_NOTICE,
  COLLECTIONS_DEPOSIT_COMPLETED_ANSWER,
  COLLECTIONS_DEPOSIT_MISSING_ANSWER,
  COLLECTIONS_FOREIGN,
  COLLECTIONS_STALE,
  COLLECTIONS_UNAVAILABLE_NOTICE,
  collectionButtonLabel,
  collectionCompletedCard,
  collectionDetailCard,
  collectionsMenuCard,
  type CollectionMenuEntry,
} from "./messages.ts";

type Screen = { text: string; keyboard?: InlineKeyboard };

type MenuContext = {
  entries: Map<string, CollectionMenuEntry>;
  availableByName: Map<string, number>;
};

function logIgnored(ctx: Context, reason: string): void {
  log.debug({ command: "/collections", userId: ctx.from?.id, chatId: ctx.chat?.id, reason }, "Command ignored");
}

async function answerStale(ctx: Context, userId: number | undefined, chatId: number | undefined, reason: string): Promise<void> {
  log.info({ userId, chatId, reason }, "Stale collections callback rejected");
  await ctx.answerCallbackQuery({ text: COLLECTIONS_STALE, show_alert: true });
}

async function loadMenuContext(repo: Repo, userId: number, chatId: number): Promise<MenuContext> {
  const [completedIds, counts] = await Promise.all([
    repo.listCompletedCollectionIds(userId, chatId),
    repo.getAvailableCatchCounts(userId, chatId),
  ]);
  const completed = new Set(completedIds);
  const availableByName = new Map(counts.map((entry) => [entry.name, entry.count]));
  const catalog = getCatalog();
  const entries = new Map<string, CollectionMenuEntry>();
  for (const collection of COLLECTIONS) {
    entries.set(collection.id, {
      collection,
      progress: collectionProgress(collection, catalog, availableByName),
      completed: completed.has(collection.id),
    });
  }
  return { entries, availableByName };
}

function listKeyboard(ownerUserId: number, context: MenuContext): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const entry of context.entries.values()) {
    keyboard.text(collectionButtonLabel(entry), buildCollectionCallbackData(ownerUserId, { kind: "view", collectionId: entry.collection.id })).row();
  }
  return keyboard;
}

async function renderList(repo: Repo, ownerUserId: number, chatId: number): Promise<Screen> {
  const context = await loadMenuContext(repo, ownerUserId, chatId);
  const entries = [...context.entries.values()];
  const completedIds = entries.filter((entry) => entry.completed).map((entry) => entry.collection.id);
  return { text: collectionsMenuCard(entries, aggregateCollectionBuffs(completedIds)), keyboard: listKeyboard(ownerUserId, context) };
}

function detailKeyboard(ownerUserId: number, entry: CollectionMenuEntry): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (!entry.completed && entry.progress.ready) {
    keyboard.text("✅ Сдать всё", buildCollectionCallbackData(ownerUserId, { kind: "deposit", collectionId: entry.collection.id })).row();
  }
  keyboard.text("← Назад", buildCollectionCallbackData(ownerUserId, { kind: "list" }));
  return keyboard;
}

async function renderDetail(repo: Repo, ownerUserId: number, chatId: number, collectionId: string, notice?: string): Promise<Screen> {
  const context = await loadMenuContext(repo, ownerUserId, chatId);
  const entry = context.entries.get(collectionId);
  if (entry === undefined) return { text: COLLECTIONS_STALE };
  return {
    text: collectionDetailCard(entry, context.availableByName, notice),
    keyboard: detailKeyboard(ownerUserId, entry),
  };
}

function playerMention(userId: number, firstName: string): string {
  return `<a href="tg://user?id=${userId}">${escapeHtml(firstName)}</a>`;
}

export function registerCollectionCommands(bot: Bot<BotContext>, repo: Repo): void {
  bot.command("collections", async (ctx) => {
    if (!isGroup(ctx) || ctx.from === undefined) {
      logIgnored(ctx, "not a group chat or sender unknown");
      return;
    }
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    await repo.ensureFisher(userId, chatId, ctx.from.first_name);
    const screen = await renderList(repo, userId, chatId);
    log.info({ userId, chatId }, "Collections menu opened");
    await ctx.api.sendMessage(chatId, screen.text, {
      reply_markup: screen.keyboard,
      ephemeral_message_parameters: { receiver_user_id: userId },
    });
    await ctx.deleteMessage();
  });

  bot.callbackQuery(/^col:/, async (ctx) => {
    const parsed = parseCollectionCallbackData(ctx.callbackQuery.data);
    if (parsed === null || ctx.from === undefined) {
      await answerStale(ctx, ctx.from?.id, ctx.chat?.id, "malformed callback or missing sender");
      return;
    }
    if (parsed.ownerUserId !== ctx.from.id) {
      log.warn({ userId: ctx.from.id, chatId: ctx.chat?.id, ownerUserId: parsed.ownerUserId }, "Foreign collections callback rejected");
      await ctx.answerCallbackQuery({ text: COLLECTIONS_FOREIGN, show_alert: true });
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

    if (parsed.action.kind === "list") {
      const screen = await renderList(repo, userId, chatId);
      await ctx.editEphemeralMessageText(screen.text, { reply_markup: screen.keyboard });
      await ctx.answerCallbackQuery();
      return;
    }

    const collection = getCollection(parsed.action.collectionId);
    if (collection === undefined) {
      await answerStale(ctx, userId, chatId, "unknown collection");
      return;
    }

    if (parsed.action.kind === "view") {
      const screen = await renderDetail(repo, userId, chatId, collection.id);
      await ctx.editEphemeralMessageText(screen.text, { reply_markup: screen.keyboard });
      await ctx.answerCallbackQuery();
      return;
    }

    const requiredNames = collectionRequiredNames(collection, getCatalog());
    const result = await repo.depositCollection({ userId, chatId, collectionId: collection.id, requiredNames });
    log.info(
      { userId, chatId, collectionId: collection.id, result: result.status, required: requiredNames.length },
      "Collection deposit attempt",
    );
    if (result.status === "completed") {
      await ctx.api.sendMessage(chatId, `${playerMention(userId, ctx.from.first_name)}\n${collectionCompletedCard(collection)}`);
      const screen = await renderDetail(repo, userId, chatId, collection.id);
      await ctx.editEphemeralMessageText(screen.text, { reply_markup: screen.keyboard });
      await ctx.answerCallbackQuery({ text: COLLECTIONS_DEPOSIT_COMPLETED_ANSWER });
      return;
    }
    const notice =
      result.status === "already_completed"
        ? COLLECTIONS_ALREADY_NOTICE
        : result.status === "missing"
          ? `${COLLECTIONS_DEPOSIT_MISSING_ANSWER} Не хватает: ${result.missing.map((name) => escapeHtml(name)).join(", ")}.`
          : COLLECTIONS_UNAVAILABLE_NOTICE;
    const answer =
      result.status === "already_completed"
        ? { text: COLLECTIONS_ALREADY_NOTICE, show_alert: false }
        : result.status === "missing"
          ? { text: COLLECTIONS_DEPOSIT_MISSING_ANSWER, show_alert: true }
          : { text: COLLECTIONS_UNAVAILABLE_NOTICE, show_alert: true };
    const screen = await renderDetail(repo, userId, chatId, collection.id, notice);
    await ctx.editEphemeralMessageText(screen.text, { reply_markup: screen.keyboard });
    await ctx.answerCallbackQuery(answer);
  });
}
