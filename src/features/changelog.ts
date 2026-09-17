import { InlineKeyboard, type Bot, type Context } from "grammy";
import { LATEST_CHANGES } from "../changes/index.ts";
import type { BotContext } from "../bot.ts";
import { log } from "../logger.ts";

const VERSIONS_PER_PAGE = 6;
const PREFIX = "chg:";

export const CHANGELOG_FOREIGN = "Это меню обновлений принадлежит другому игроку.";
export const CHANGELOG_STALE = "Кнопка устарела. Откройте /changelog заново.";

type ChangelogAction = { kind: "page"; page: number } | { kind: "version"; versionIndex: number };
type ParsedChangelogData = { ownerUserId: number; action: ChangelogAction };

function encodeOwnerId(value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Owner ID must be a positive safe integer");
  return value.toString(36);
}

function decodeOwnerId(value: string): number | null {
  if (!/^[0-9a-z]+$/.test(value)) return null;
  const parsed = parseInt(value, 36);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function decodeIndex(value: string): number | null {
  if (!/^[0-9a-z]+$/.test(value)) return null;
  const parsed = parseInt(value, 36);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function buildCallbackData(ownerUserId: number, action: ChangelogAction): string {
  const data = `${PREFIX}${encodeOwnerId(ownerUserId)}:${action.kind === "page" ? "p" : "v"}:${(action.kind === "page" ? action.page : action.versionIndex).toString(36)}`;
  if (Buffer.byteLength(data, "utf8") > 64) throw new Error("Telegram callback_data exceeds 64 bytes");
  return data;
}

export function parseChangelogCallbackData(data: string): ParsedChangelogData | null {
  const match = /^chg:([0-9a-z]+):(p|v):([0-9a-z]+)$/.exec(data);
  if (match === null) return null;
  const ownerUserId = decodeOwnerId(match[1]!);
  const index = decodeIndex(match[3]!);
  if (ownerUserId === null || index === null) return null;
  return match[2] === "p"
    ? { ownerUserId, action: { kind: "page", page: index } }
    : { ownerUserId, action: { kind: "version", versionIndex: index } };
}

function pageCount(): number {
  return Math.ceil(LATEST_CHANGES.length / VERSIONS_PER_PAGE);
}

function listScreen(ownerUserId: number, page: number): { text: string; keyboard: InlineKeyboard } | null {
  const pages = pageCount();
  if (page < 0 || page >= pages) return null;
  const firstIndex = page * VERSIONS_PER_PAGE;
  const versions = LATEST_CHANGES.slice(firstIndex, firstIndex + VERSIONS_PER_PAGE);
  const keyboard = new InlineKeyboard();

  versions.forEach((change, offset) => {
    keyboard.text(`v${change.version}`, buildCallbackData(ownerUserId, { kind: "version", versionIndex: firstIndex + offset }));
    if (offset % 2 === 1 || offset === versions.length - 1) keyboard.row();
  });
  if (pages > 1) {
    if (page > 0) keyboard.text("← Новее", buildCallbackData(ownerUserId, { kind: "page", page: page - 1 }));
    if (page < pages - 1) keyboard.text("Старее →", buildCallbackData(ownerUserId, { kind: "page", page: page + 1 }));
  }

  return {
    text: `<b>Обновления</b>\n\nВыберите версию.\nСтраница ${page + 1} из ${pages}.`,
    keyboard,
  };
}

function versionScreen(ownerUserId: number, versionIndex: number): { text: string; keyboard: InlineKeyboard } | null {
  const change = LATEST_CHANGES[versionIndex];
  if (change === undefined) return null;
  const page = Math.floor(versionIndex / VERSIONS_PER_PAGE);
  return {
    text: `<b>Обновление v${change.version}</b>\n\n${change.updates.map((update) => `• ${update}`).join("\n")}`,
    keyboard: new InlineKeyboard().text("← К версиям", buildCallbackData(ownerUserId, { kind: "page", page })),
  };
}

async function answerStale(ctx: Context, reason: string): Promise<void> {
  log.info({ userId: ctx.from?.id, chatId: ctx.chat?.id, reason }, "Stale changelog callback rejected");
  await ctx.answerCallbackQuery({ text: CHANGELOG_STALE, show_alert: true });
}

export function registerChangelogCommand(bot: Bot<BotContext>): void {
  bot.command("changelog", async (ctx) => {
    if (ctx.from === undefined) return;
    const screen = listScreen(ctx.from.id, 0);
    if (screen === null) return;
    await ctx.reply(screen.text, { reply_markup: screen.keyboard });
    log.debug({ chatId: ctx.chat?.id, userId: ctx.from.id }, "Changelog menu sent");
  });

  bot.callbackQuery(/^chg:/, async (ctx) => {
    const parsed = parseChangelogCallbackData(ctx.callbackQuery.data);
    if (parsed === null || ctx.from === undefined) {
      await answerStale(ctx, "malformed callback or missing sender");
      return;
    }
    if (parsed.ownerUserId !== ctx.from.id) {
      log.warn({ userId: ctx.from.id, chatId: ctx.chat?.id, ownerUserId: parsed.ownerUserId }, "Foreign changelog callback rejected");
      await ctx.answerCallbackQuery({ text: CHANGELOG_FOREIGN, show_alert: true });
      return;
    }

    const screen = parsed.action.kind === "page" ? listScreen(ctx.from.id, parsed.action.page) : versionScreen(ctx.from.id, parsed.action.versionIndex);
    if (screen === null) {
      await answerStale(ctx, "out-of-range page or version");
      return;
    }
    await ctx.editMessageText(screen.text, { reply_markup: screen.keyboard });
    await ctx.answerCallbackQuery();
  });
}
