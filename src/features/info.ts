import type { Bot } from "grammy";
import type { BotContext } from "../bot.ts";
import { log } from "../logger.ts";
import { BOT_VERSION_LABEL, REPO_URL } from "../version.ts";

const INFO_TEXT =
  `🐟 <b>FishCatcher Bot</b> — ${BOT_VERSION_LABEL}\n\n` +
  `Ловите рыбу в групповых чатах, копите баланс и соревнуйтесь с друзьями.\n\n` +
  `<b>Команды:</b>\n` +
  `/fish — попытка поймать рыбу\n` +
  `/fishes — список рыб, редкостей и шансов\n` +
  `/fishtop — топ рыбаков чата\n` +
  `/stats — ваша статистика\n` +
  `/info — информация о боте\n\n` +
  `<b>Репозиторий:</b> ${REPO_URL}\n\n` +
  `⚠️ Статус: бета. Возможны изменения и перерывы на обслуживание.`;

export function registerInfoCommands(bot: Bot<BotContext>): void {
  bot.command("info", async (ctx) => {
    await ctx.reply(INFO_TEXT);
    log.debug({ chatId: ctx.chat?.id, userId: ctx.from?.id }, "Info sent");
  });
}
