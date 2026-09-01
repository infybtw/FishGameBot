import { Bot, type Context } from "grammy";
import { type Conversation, type ConversationFlavor, conversations } from "@grammyjs/conversations";
import { autoRetry } from "@grammyjs/auto-retry";
import type { Config } from "./config.ts";
import type { Repo } from "./db/index.ts";
import type { Catalog } from "./features/fishing/catalog.ts";
import { registerGroupCommands } from "./features/fishing/commands.ts";
import { registerAdminCommands } from "./features/admin/commands.ts";
import { log } from "./logger.ts";

export type BotContext = ConversationFlavor<Context>;
export type FishConversation = Conversation<BotContext, Context>;
export type CatalogAccess = { reload(): Promise<Catalog | null> };

export function createBot(cfg: Config, repo: Repo, catalogAccess: CatalogAccess): Bot<BotContext> {
  const bot = new Bot<BotContext>(cfg.botToken);
  // HTML is the default parse mode for outgoing messages; an explicit
  // parse_mode in a call still wins. (Replaces @grammyjs/parse-mode's
  // `parseMode("HTML")`, which v2 of that plugin no longer ships.)
  bot.api.config.use((prev, method, payload, signal) =>
    prev(method, { parse_mode: "HTML", ...payload }, signal),
  );
  bot.api.config.use(autoRetry());

  // Every incoming update gets a line; commands are worth info, the rest debug.
  bot.use((ctx, next) => {
    const message = ctx.message ?? ctx.editedMessage;
    const command =
      typeof message?.text === "string" && message.text.startsWith("/")
        ? message.text.slice(1).split(/[ @\n]/)[0]
        : undefined;
    if (command !== undefined) {
      log.info({ command, userId: ctx.from?.id, chatId: ctx.chat?.id }, "Command received");
    } else {
      log.debug({ updateId: ctx.update.update_id, userId: ctx.from?.id, chatId: ctx.chat?.id }, "Update received");
    }
    return next();
  });
  bot.use(conversations());
  registerGroupCommands(bot, cfg, repo);

  bot.catch((err) => log.error({ err: err.error }, "update handler failed"));

  return bot;
}
