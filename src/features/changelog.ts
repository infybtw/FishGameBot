import type { Bot } from "grammy";
import { LATEST_CHANGES } from "../changes/index.ts";
import type { BotContext } from "../bot.ts";
import { log } from "../logger.ts";

export const CHANGELOG_TEXT =
  `<b>Последние обновления</b>\n\n` +
  LATEST_CHANGES.map(
    ({ version, updates }) => `<b>${version}</b>\n${updates.map((update) => `• ${update}`).join("\n")}`,
  ).join("\n\n");

export function registerChangelogCommand(bot: Bot<BotContext>): void {
  bot.command("changelog", async (ctx) => {
    await ctx.reply(CHANGELOG_TEXT);
    log.debug({ chatId: ctx.chat?.id, userId: ctx.from?.id }, "Changelog sent");
  });
}
