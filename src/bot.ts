import { Bot, type Context } from "grammy";
import { type Conversation, type ConversationFlavor, conversations } from "@grammyjs/conversations";
import { autoRetry } from "@grammyjs/auto-retry";
import type { Config } from "./config.ts";
import type { Repo } from "./db/index.ts";
import type { Catalog } from "./features/fishing/catalog.ts";
import { registerAdminCommands } from "./features/admin/commands.ts";
import { registerGroupCommands } from "./features/fishing/commands.ts";
import { registerInfoCommands } from "./features/info.ts";
import { registerChangelogCommand } from "./features/changelog.ts";
import { registerNetCommands } from "./features/nets/commands.ts";
import { registerUpgradeCommands } from "./features/upgrades/commands.ts";
import { registerTradeCommands } from "./features/trades/commands.ts";
import { log } from "./logger.ts";

export type BotContext = ConversationFlavor<Context>;
export type FishConversation = Conversation<BotContext, Context>;
export type CatalogAccess = { reload(): Promise<Catalog | null> };

export function trackBotMessages(repo: Repo) {
  return async <T>(
    prev: (method: string, payload: unknown, signal?: AbortSignal) => Promise<T>,
    method: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<T> => {
    const result = await prev(method, payload, signal);
    const chatId = (payload as { chat_id?: unknown }).chat_id;
    // API transformers receive Telegram's raw { ok, result } envelope.
    const message = (result as {
      result?: { message_id?: unknown; text?: unknown; caption?: unknown; from?: { id?: unknown } };
    }).result;
    const messageId = message?.message_id;
    if (typeof chatId !== "number" || typeof messageId !== "number") return result;
    const senderUserId = typeof message?.from?.id === "number" ? message.from.id : null;
    const payloadMessage = payload as { text?: unknown; caption?: unknown };
    const messageText =
      typeof message?.text === "string"
        ? message.text
        : typeof message?.caption === "string"
          ? message.caption
          : typeof payloadMessage.text === "string"
            ? payloadMessage.text
            : typeof payloadMessage.caption === "string"
              ? payloadMessage.caption
              : null;

    try {
      await repo.trackChatMessage(chatId, messageId, senderUserId, true, false, messageText);
    } catch (err) {
      // Tracking must never turn a successfully delivered bot response into an error.
      log.error({ err, chatId, messageId }, "Failed to track bot message");
    }
    return result;
  };
}

function isCommandForThisBot(ctx: BotContext, text: string): boolean {
  const match = /^\/[^\s@]+(?:@([a-zA-Z0-9_]+))?/.exec(text);
  if (match === null) return false;
  const targetUsername = match[1];
  return targetUsername === undefined || targetUsername.toLowerCase() === ctx.me.username?.toLowerCase();
}

function getMessageText(message: { text?: unknown; caption?: unknown }): string | null {
  return typeof message.text === "string" ? message.text : typeof message.caption === "string" ? message.caption : null;
}

export function createBot(cfg: Config, repo: Repo, catalogAccess: CatalogAccess): Bot<BotContext> {
  const bot = new Bot<BotContext>(cfg.botToken);
  // HTML is the default parse mode for outgoing messages; an explicit
  // parse_mode in a call still wins. (Replaces @grammyjs/parse-mode's
  // `parseMode("HTML")`, which v2 of that plugin no longer ships.)
  bot.api.config.use((prev, method, payload, signal) =>
    prev(method, { parse_mode: "HTML", ...payload }, signal),
  );
  bot.api.config.use(autoRetry());
  bot.api.config.use(trackBotMessages(repo) as never);

  // Every incoming update gets a line; commands are worth info, the rest debug.
  bot.use(async (ctx, next) => {
    const message = ctx.message ?? ctx.editedMessage;
    const command =
      typeof message?.text === "string" && message.text.startsWith("/")
        ? message.text.slice(1).split(/[ @\n]/)[0]
        : undefined;
    if (message !== undefined && ctx.chat !== undefined) {
      try {
        await repo.trackChatMessage(
          ctx.chat.id,
          message.message_id,
          ctx.from?.id ?? null,
          false,
          typeof message.text === "string" && isCommandForThisBot(ctx, message.text),
          getMessageText(message),
        );
      } catch (err) {
        log.error({ err, chatId: ctx.chat.id, messageId: message.message_id }, "Failed to track chat message");
      }
    }
    if (command !== undefined) {
      log.info({ command, userId: ctx.from?.id, chatId: ctx.chat?.id }, "Command received");
    } else {
      log.debug({ updateId: ctx.update.update_id, userId: ctx.from?.id, chatId: ctx.chat?.id }, "Update received");
    }
    return next();
  });
  bot.use(conversations());
  registerGroupCommands(bot, cfg, repo);
  registerUpgradeCommands(bot, cfg, repo);
  registerNetCommands(bot, repo);
  registerTradeCommands(bot, repo);
  registerInfoCommands(bot);
  registerChangelogCommand(bot);
  registerAdminCommands(bot, cfg, repo, catalogAccess);
  bot.catch((err) => log.error({ err: err.error }, "update handler failed"));

  return bot;
}
