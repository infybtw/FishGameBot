import { type Bot, type Context } from "grammy";
import type { User } from "grammy/types";
import type { BotContext } from "../../bot.ts";
import type { Config } from "../../config.ts";
import type { Repo } from "../../db/index.ts";
import { isAdmin, isGroup } from "../../guards.ts";
import { log } from "../../logger.ts";
import { CHANCE_UP_POINTS, getCatalog, hasRarityGroup } from "./catalog.ts";
import { checkCooldown, cooldownSecondsLeft } from "./cooldown.ts";
import { boostedCatch, fakeFishCatch, tryCatch, type CaughtFish } from "./generator.ts";
import {
  CDR_USAGE,
  CHANCE_UP_CATALOG_EMPTY,
  CHANCE_UP_USAGE,
  COOLDOWNS_EMPTY,
  CR_USAGE,
  FAKE_FISH_CATALOG_EMPTY,
  catchCard,
  chanceUpGranted,
  cooldownList,
  cooldownMsg,
  cooldownReset,
  cooldownsResetAll,
  fishCatalogMessage,
  lastCatchMissing,
  lastCatchRemoved,
  nothingCaught,
  statsEmpty,
  statsMsg,
  topFishers,
} from "./messages.ts";

const FAKE_FISH_POINTS = [5, 6] as const;

function logIgnored(ctx: Context, reason: string): void {
  log.debug(
    { command: ctx.message?.text?.split(/\s/)[0], userId: ctx.from?.id, chatId: ctx.chat?.id, reason },
    "Command ignored",
  );
}

/** Command-reply target: a non-bot Telegram user, or null when absent or ineligible. */
function replyTarget(ctx: Context): { id: number; firstName: string } | null {
  const from = ctx.message?.reply_to_message?.from;
  return from === undefined || from.is_bot ? null : { id: from.id, firstName: from.first_name };
}

function isAdminInGroup(ctx: Context, cfg: Config): ctx is Context & { from: User } {
  return ctx.from !== undefined && isGroup(ctx) && isAdmin(ctx, cfg.adminUserId);
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

    const catalog = getCatalog();
    const chanceUp = await repo.hasChanceUp(userId, chatId);
    if (chanceUp && !hasRarityGroup(catalog, CHANCE_UP_POINTS)) {
      // Keep the bonus pending and start no cooldown, so the promised boosted
      // catch survives until the catalog has rarity 2-6 templates again.
      log.info({ userId, chatId }, "Chance-up catch deferred: no rarity 2-6 templates");
      await ctx.reply(CHANCE_UP_CATALOG_EMPTY);
      return;
    }

    const cooldown = await checkCooldown(repo, cfg, userId, chatId);
    if (!cooldown.ok) {
      log.info({ userId, chatId, secondsLeft: cooldown.secondsLeft }, "Catch attempt blocked by cooldown");
      await ctx.reply(cooldownMsg(firstName, cooldown.secondsLeft));
      return;
    }

    // Runs on every allowed attempt: a user who catches nothing still appears in top with 0.
    await repo.ensureFisher(userId, chatId, firstName);
    let fish: CaughtFish | null;
    let boosted = false;
    if (chanceUp && (await repo.consumeChanceUp(userId, chatId))) {
      boosted = true;
      fish = boostedCatch(catalog, firstName);
    } else {
      fish = tryCatch(catalog, cfg, firstName);
    }
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
        boosted,
      },
      "Fish caught",
    );
    await ctx.reply(catchCard(fish));
  });

  bot.command("cdr", async (ctx) => {
    if (!isAdminInGroup(ctx, cfg)) {
      logIgnored(ctx, "not a group chat or sender is not the admin");
      return;
    }
    const target = replyTarget(ctx);
    if (target === null) {
      await ctx.reply(CDR_USAGE);
      return;
    }
    await repo.deleteCatchTime(target.id, ctx.chat.id);
    log.info({ targetUserId: target.id, chatId: ctx.chat.id }, "Cooldown reset");
    await ctx.reply(cooldownReset(target.firstName));
  });

  bot.command("cdr_all", async (ctx) => {
    if (!isAdminInGroup(ctx, cfg)) {
      logIgnored(ctx, "not a group chat or sender is not the admin");
      return;
    }
    const removed = await repo.deleteCatchTimes(ctx.chat.id);
    log.info({ chatId: ctx.chat.id, removed }, "All cooldowns reset");
    await ctx.reply(removed === 0 ? COOLDOWNS_EMPTY : cooldownsResetAll(removed));
  });

  bot.command("cd", async (ctx) => {
    if (!isAdminInGroup(ctx, cfg)) {
      logIgnored(ctx, "not a group chat or sender is not the admin");
      return;
    }
    const rows = await repo.listCatchTimes(ctx.chat.id);
    const now = Date.now() / 1000;
    log.debug({ chatId: ctx.chat.id, rows: rows.length }, "Cooldowns listed");
    await ctx.reply(
      cooldownList(
        rows.map((row) => {
          const secondsLeft = cooldownSecondsLeft(row.lastCatchTime, cfg.catchDelaySeconds, now);
          return { firstName: row.firstName, minutesLeft: secondsLeft > 0 ? Math.ceil(secondsLeft / 60) : 0 };
        }),
      ),
    );
  });

  bot.command("fakefish", async (ctx) => {
    if (!isAdminInGroup(ctx, cfg)) {
      logIgnored(ctx, "not a group chat or sender is not the admin");
      return;
    }
    const catalog = getCatalog();
    if (!hasRarityGroup(catalog, FAKE_FISH_POINTS)) {
      await ctx.reply(FAKE_FISH_CATALOG_EMPTY);
      return;
    }
    const fish = fakeFishCatch(catalog, ctx.from.first_name);
    log.info({ userId: ctx.from.id, chatId: ctx.chat.id, fish: fish.name, point: fish.point }, "Fake fish shown");
    await ctx.reply(catchCard(fish));
  });

  bot.command("chanceup", async (ctx) => {
    if (!isAdminInGroup(ctx, cfg)) {
      logIgnored(ctx, "not a group chat or sender is not the admin");
      return;
    }
    const target = replyTarget(ctx);
    if (target === null) {
      await ctx.reply(CHANCE_UP_USAGE);
      return;
    }
    if (!hasRarityGroup(getCatalog(), CHANCE_UP_POINTS)) {
      await ctx.reply(CHANCE_UP_CATALOG_EMPTY);
      return;
    }
    await repo.grantChanceUp(target.id, ctx.chat.id);
    log.info({ targetUserId: target.id, chatId: ctx.chat.id }, "Chance-up granted");
    await ctx.reply(chanceUpGranted(target.firstName));
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

  bot.command("cr", async (ctx) => {
    if (!isAdminInGroup(ctx, cfg)) {
      logIgnored(ctx, "not a group chat or sender is not the admin");
      return;
    }
    const target = replyTarget(ctx);
    if (target === null) {
      await ctx.reply(CR_USAGE);
      return;
    }
    const removed = await repo.deleteLastCatch(target.id, ctx.chat.id);
    if (removed === null) {
      await ctx.reply(lastCatchMissing(target.firstName));
      return;
    }
    log.info(
      { targetUserId: target.id, chatId: ctx.chat.id, fish: removed.fishName, price: removed.price },
      "Catch removed",
    );
    await ctx.reply(lastCatchRemoved(target.firstName, removed));
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
