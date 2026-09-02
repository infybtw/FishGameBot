import { type Bot, type Context } from "grammy";
import type { BotContext } from "../../bot.ts";
import type { Config } from "../../config.ts";
import type { Repo } from "../../db/index.ts";
import { isGroup } from "../../guards.ts";
import { log } from "../../logger.ts";
import { getCatalog } from "./catalog.ts";
import { checkCooldown } from "./cooldown.ts";
import { tryCatch } from "./generator.ts";
import {
  catchCard,
  cooldownMsg,
  fishCatalogMessage,
  nothingCaught,
  statsEmpty,
  statsMsg,
  topFishers,
} from "./messages.ts";

function logIgnored(ctx: Context, reason: string): void {
  log.debug(
    { command: ctx.message?.text?.split(/\s/)[0], userId: ctx.from?.id, chatId: ctx.chat?.id, reason },
    "Command ignored",
  );
}

export function registerGroupCommands(bot: Bot<BotContext>, cfg: Config, repo: Repo): void {
  bot.command("fish", async (ctx) => {
    if (!isGroup(ctx) || ctx.from === undefined) {
      logIgnored(ctx, "not a group chat or sender unknown");
      return;
    }
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const firstName = ctx.from.first_name;

    const cooldown = await checkCooldown(repo, cfg, userId, chatId);
    if (!cooldown.ok) {
      log.info({ userId, chatId, secondsLeft: cooldown.secondsLeft }, "Catch attempt blocked by cooldown");
      await ctx.reply(cooldownMsg(firstName, cooldown.secondsLeft));
      return;
    }

    // Runs on every allowed attempt: a user who catches nothing still appears in top with 0.
    await repo.ensureFisher(userId, chatId, firstName);
    const fish = tryCatch(getCatalog(), cfg, firstName);
    if (fish === null) {
      log.info({ userId, chatId }, "Catch attempt finished without a fish");
      await ctx.reply(nothingCaught(firstName));
      return;
    }

    await repo.recordCatchWithBalance(
      {
        username: firstName,
        userId,
        chatId,
        fishName: fish.name,
        rarity: fish.rarity,
        point: fish.point,
        sizeCm: fish.sizeCm,
        weightG: fish.weightG,
        price: fish.price,
      },
      fish.price,
    );
    log.info(
      {
        userId,
        chatId,
        fish: fish.name,
        rarity: fish.rarity,
        point: fish.point,
        sizeCm: fish.sizeCm,
        weightG: fish.weightG,
        price: fish.price,
      },
      "Fish caught",
    );
    await ctx.reply(catchCard(fish));
  });

  bot.command("fishes", async (ctx) => {
    if (!isGroup(ctx)) {
      logIgnored(ctx, "not a group chat");
      return;
    }
    const catalog = getCatalog();
    let fishCount = 0;
    for (const group of catalog) fishCount += group?.length ?? 0;
    log.debug({ chatId: ctx.chat.id, fishCount }, "Fish catalog requested");
    await ctx.reply(fishCatalogMessage(catalog));
  });

  bot.command("fishtop", async (ctx) => {
    if (!isGroup(ctx)) {
      logIgnored(ctx, "not a group chat");
      return;
    }
    const rows = await repo.getTopFishers(ctx.chat.id, 10);
    log.debug({ chatId: ctx.chat.id, rows: rows.length }, "Fishtop calculated");
    await ctx.reply(topFishers(rows));
  });

  bot.command("stats", async (ctx) => {
    if (!isGroup(ctx) || ctx.from === undefined) {
      logIgnored(ctx, "not a group chat or sender unknown");
      return;
    }
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const fisher = await repo.getFisher(userId, chatId);
    if (fisher === null) {
      log.debug({ userId, chatId }, "Stats requested by unknown fisher");
      await ctx.reply(statsEmpty(ctx.from.first_name));
      return;
    }
    const [totalPrice, count, ...rarityCounts] = await Promise.all([
      repo.sumUserFishPrice(userId, chatId),
      repo.countUserFishes(userId, chatId),
      ...[1, 2, 3, 4, 5, 6].map((point) => repo.countUserFishesByRarity(userId, chatId, point)),
    ]);
    log.debug({ userId, chatId, count }, "Stats calculated");
    await ctx.reply(statsMsg(userId, ctx.from.first_name, totalPrice, fisher.balance, count, rarityCounts));
  });
}
