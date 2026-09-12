import { type Bot, type Context } from "grammy";
import type { User } from "grammy/types";
import type { BotContext } from "../../bot.ts";
import type { Config } from "../../config.ts";
import type { Repo } from "../../db/index.ts";
import { isAdmin, isGroup, replyTarget } from "../../guards.ts";
import { log } from "../../logger.ts";
import { getRod } from "../upgrades/rods.ts";
import { CHANCE_UP_POINTS, getCatalog, hasRarityGroup } from "./catalog.ts";
import { checkCooldown, cooldownSecondsLeft } from "./cooldown.ts";
import { rollBalanceMultiplier, rollCurse, type Curse } from "./curses.ts";
import { boostedCatch, fakeFishCatch, tryCatch, type CaughtFish, type PriceModifier } from "./generator.ts";
import {
  CDR_USAGE,
  CDA_INVALID_DURATION,
  CDA_USAGE,
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
  eventScheduleMessage,
  eventStatusMessage,
  fishCatalogMessage,
  goldenScalesCurse,
  heavyNetCurse,
  lastCatchMissing,
  lastCatchRemoved,
  kamazCooldown,
  nothingCaught,
  secondCastCurse,
  statsEmpty,
  statsMsg,
  topFishers,
} from "./messages.ts";
import {
  eventCooldownSeconds,
  getActiveTimeEvent,
  getActiveTimeEventNow,
  getFishingModifiers,
  getNextTimeEvent,
} from "./time-events.ts";

const FAKE_FISH_POINTS = [5, 6] as const;
const DEFAULT_CDA_HOURS = 12;

function parseCooldownHours(raw: string): number | null {
  const value = raw.trim();
  if (value === "") return DEFAULT_CDA_HOURS;
  if (!/^\d+$/.test(value)) return null;
  const hours = Number(value);
  return Number.isSafeInteger(hours) && hours > 0 && hours <= Math.floor(Number.MAX_SAFE_INTEGER / 3600) ? hours : null;
}

function logIgnored(ctx: Context, reason: string): void {
  log.debug(
    { command: ctx.message?.text?.split(/\s/)[0], userId: ctx.from?.id, chatId: ctx.chat?.id, reason },
    "Command ignored",
  );
}

function isAdminInGroup(ctx: Context, cfg: Config): ctx is Context & { from: User } {
  return ctx.from !== undefined && isGroup(ctx) && isAdmin(ctx, cfg.adminUserId);
}

/** Applies the curse's effect with chat-scoped repo semantics and returns its message. */
async function applyCurse(
  curse: Curse,
  repo: Repo,
  cfg: Config,
  userId: number,
  chatId: number,
  cooldownStartedAt: number,
): Promise<string> {
  switch (curse.kind) {
    case "heavy_net": {
      // Normal expiry adds CATCH_DELAY to the stored timestamp, so rewriting
      // startedAt + delay makes this catch take exactly CATCH_DELAY * 2.
      await repo.upsertCatchTime(userId, chatId, cooldownStartedAt + cfg.catchDelaySeconds, cfg.catchDelaySeconds);
      return heavyNetCurse(cfg.catchDelaySeconds);
    }
    case "second_cast": {
      await repo.deleteCatchTime(userId, chatId);
      return secondCastCurse();
    }
    case "golden_scales": {
      const multiplier = rollBalanceMultiplier();
      await repo.multiplyBalance(userId, chatId, multiplier);
      return goldenScalesCurse(multiplier);
    }
  }
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

    // Modifiers are resolved once per attempt so the cooldown check and the
    // stored cooldown duration always describe the same attempt.
    const activeEvent = getActiveTimeEventNow(cfg.eventTimeZone);
    const modifiers = getFishingModifiers(activeEvent);
    const cooldown = await checkCooldown(repo, cfg, userId, chatId, eventCooldownSeconds(cfg.catchDelaySeconds, modifiers));
    if (!cooldown.ok) {
      log.info({ userId, chatId, secondsLeft: cooldown.secondsLeft }, "Catch attempt blocked by cooldown");
      await ctx.reply(cooldownMsg(firstName, cooldown.secondsLeft));
      return;
    }

    // Runs on every allowed attempt: a user who catches nothing still appears in top with 0.
    await repo.ensureFisher(userId, chatId, firstName);
    const rod = getRod((await repo.getEquippedRodId(userId, chatId)) ?? "basic") ?? getRod("basic")!;
    const successChance = Math.min(100, cfg.catchSuccessChance + rod.catchBonusPoints + modifiers.successChanceBonusPoints);
    let fish: CaughtFish | null;
    let boosted = false;
    const rarityWeights = modifiers.guaranteedRarityWeights ?? modifiers.rarityWeights ?? undefined;
    const priceModifier: PriceModifier | undefined =
      modifiers.priceMultiplier === 1
        ? undefined
        : {
            multiplier: modifiers.priceMultiplier,
            minPoint: modifiers.priceMultiplierMinPoint,
            maxPoint: modifiers.priceMultiplierMaxPoint,
          };
    if (chanceUp && modifiers.guaranteedRarityWeights === null && (await repo.consumeChanceUp(userId, chatId))) {
      boosted = true;
      fish = boostedCatch(catalog, firstName, rod.rarityStepBonus, cfg.fishModifierDropChance, priceModifier);
    } else {
      fish = tryCatch(catalog, firstName, successChance, rod.rarityStepBonus, cfg.fishModifierDropChance, rarityWeights, priceModifier);
    }
    if (fish === null) {
      log.info(
        {
          userId,
          chatId,
          eventId: activeEvent === null ? null : activeEvent.event.id,
          modifiers: { ...modifiers, guaranteedRarityWeights: modifiers.guaranteedRarityWeights === null ? null : { ...modifiers.guaranteedRarityWeights } },
        },
        "Catch attempt finished without a fish",
      );
      await ctx.reply(nothingCaught(firstName));
      return;
    }

    await repo.recordCatch({
      username: firstName,
      userId,
      chatId,
      fishName: fish.name,
      rarity: fish.rarity,
      point: fish.point,
      sizeCm: fish.sizeCm,
      weightG: fish.weightG,
      price: fish.price,
      fishModifierId: fish.modifier?.id ?? null,
      fishModifierName: fish.modifier?.name ?? null,
      fishModifierRarity: fish.modifier?.rarity ?? null,
    });
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
        fishModifier: fish.modifier?.id ?? null,
        boosted,
        rodId: rod.id,
        eventId: activeEvent === null ? null : activeEvent.event.id,
        modifiers: { ...modifiers, guaranteedRarityWeights: modifiers.guaranteedRarityWeights === null ? null : { ...modifiers.guaranteedRarityWeights } },
      },
      "Fish caught",
    );
    const curse = rollCurse(cfg.curseDropChance);
    if (curse === null) {
      await ctx.reply(catchCard(fish, activeEvent === null ? null : activeEvent.event));
      return;
    }
    const curseText = await applyCurse(curse, repo, cfg, userId, chatId, cooldown.startedAt);
    log.info({ userId, chatId, curse: curse.kind }, "Curse applied");
    await ctx.reply(`${catchCard(fish, activeEvent === null ? null : activeEvent.event)}\n\n${curseText}`);
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

  bot.command("cda", async (ctx) => {
    if (!isAdminInGroup(ctx, cfg)) {
      logIgnored(ctx, "not a group chat or sender is not the admin");
      return;
    }
    const target = replyTarget(ctx);
    if (target === null) {
      await ctx.reply(CDA_USAGE);
      return;
    }
    const hours = parseCooldownHours(ctx.match);
    if (hours === null) {
      await ctx.reply(CDA_INVALID_DURATION);
      return;
    }
    const delaySeconds = hours * 3600;
    await repo.upsertCatchTime(target.id, ctx.chat.id, Date.now() / 1000, delaySeconds);
    log.info({ targetUserId: target.id, chatId: ctx.chat.id, hours }, "Kamaz cooldown applied");
    await ctx.reply(kamazCooldown(hours));
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
    const rows = await repo.listCatchTimes(ctx.chat.id, cfg.catchDelaySeconds);
    const now = Date.now() / 1000;
    log.debug({ chatId: ctx.chat.id, rows: rows.length }, "Cooldowns listed");
    await ctx.reply(
      cooldownList(
        rows.map((row) => {
          const secondsLeft = cooldownSecondsLeft(row.lastCatchTime, row.delaySeconds, now);
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
    const fish = fakeFishCatch(catalog, ctx.from.first_name, cfg.fishModifierDropChance);
    log.info(
      { userId: ctx.from.id, chatId: ctx.chat.id, fish: fish.name, point: fish.point, fishModifier: fish.modifier?.id ?? null },
      "Fake fish shown",
    );
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
    await ctx.reply(fishCatalogMessage(catalog, cfg.fishModifierDropChance));
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

  bot.command("event", async (ctx) => {
    if (!isGroup(ctx)) {
      logIgnored(ctx, "not a group chat");
      return;
    }
    const now = new Date(Date.now());
    const active = getActiveTimeEvent(now, cfg.eventTimeZone);
    const next = getNextTimeEvent(now, cfg.eventTimeZone);
    log.debug({ chatId: ctx.chat.id, eventId: active === null ? null : active.event.id }, "Event status requested");
    await ctx.reply(eventStatusMessage(active, next, cfg.eventTimeZone));
  });

  bot.command("events", async (ctx) => {
    if (!isGroup(ctx)) {
      logIgnored(ctx, "not a group chat");
      return;
    }
    const active = getActiveTimeEvent(new Date(Date.now()), cfg.eventTimeZone);
    log.debug({ chatId: ctx.chat.id, eventId: active === null ? null : active.event.id }, "Event schedule requested");
    await ctx.reply(eventScheduleMessage(cfg.eventTimeZone, active === null ? null : active.event.id));
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
