import { expect, test } from "bun:test";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import type { BotContext } from "../bot.ts";
import { CHANGELOG_FOREIGN, parseChangelogCallbackData, registerChangelogCommand } from "./changelog.ts";

type ApiCall = { method: string; payload: Record<string, unknown> };

function commandUpdate(): Update {
  return {
    update_id: 1,
    message: {
      message_id: 1, date: 0, chat: { id: -100, type: "supergroup", title: "Рыбаки" },
      from: { id: 1, is_bot: false, first_name: "Игрок" }, text: "/changelog",
      entities: [{ type: "bot_command", offset: 0, length: 10 }],
    },
  } as Update;
}

function callbackUpdate(data: string, userId = 1, ephemeral = false): Update {
  return {
    update_id: 2,
    callback_query: {
      id: "query-2", from: { id: userId, is_bot: false, first_name: "Игрок" }, chat_instance: "instance", data,
      message: {
        message_id: 2, date: 0, chat: { id: -100, type: "supergroup", title: "Рыбаки" }, from: { id: 999, is_bot: true, first_name: "FishBot" }, text: "Обновления",
        ...(ephemeral ? { receiver_user: { id: userId, is_bot: false, first_name: "Игрок" }, ephemeral_message_id: 12 } : {}),
      },
    },
  } as Update;
}

function buttonData(call: ApiCall, label: string): string {
  const markup = call.payload.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
  const button = markup.inline_keyboard.flat().find((item) => item.text === label);
  if (button === undefined) throw new Error(`Button ${label} not found`);
  return button.callback_data;
}

test("/changelog shows a paginated version menu", async () => {
  const bot = new Bot<BotContext>("123:test", { botInfo: { id: 999, is_bot: true, first_name: "FishBot", username: "fishbot" } as never });
  const calls: ApiCall[] = [];
  bot.api.config.use(async (_prev, method, payload) => { calls.push({ method, payload: payload as Record<string, unknown> }); return { ok: true, result: true } as never; });
  registerChangelogCommand(bot);

  await bot.handleUpdate(commandUpdate());

  expect(calls).toHaveLength(1);
  expect(calls[0]!.method).toBe("sendMessage");
  expect(calls[0]!.payload.text).toContain("Страница 1 из");
  expect(buttonData(calls[0]!, "v0.13.0")).toMatch(/^chg:1:v:1$/);
  expect(buttonData(calls[0]!, "Старее →")).toMatch(/^chg:1:p:1$/);
});

test("changelog version buttons show the selected version only to their owner", async () => {
  const bot = new Bot<BotContext>("123:test", { botInfo: { id: 999, is_bot: true, first_name: "FishBot", username: "fishbot" } as never });
  const calls: ApiCall[] = [];
  bot.api.config.use(async (_prev, method, payload) => { calls.push({ method, payload: payload as Record<string, unknown> }); return { ok: true, result: true } as never; });
  registerChangelogCommand(bot);
  await bot.handleUpdate(commandUpdate());
  const versionData = buttonData(calls[0]!, "v0.13.0");
  calls.length = 0;

  await bot.handleUpdate(callbackUpdate(versionData));

  expect(calls.map((call) => call.method)).toEqual(["editMessageText", "answerCallbackQuery"]);
  expect(calls[0]!.payload.text).toContain("Обновление v0.13.0");
  expect(buttonData(calls[0]!, "← К версиям")).toMatch(/^chg:1:p:0$/);

  calls.length = 0;
  await bot.handleUpdate(callbackUpdate(versionData, 2));
  expect(calls).toEqual([{ method: "answerCallbackQuery", payload: { callback_query_id: "query-2", text: CHANGELOG_FOREIGN, show_alert: true } }]);
});

test("changelog callback data rejects malformed values", () => {
  expect(parseChangelogCallbackData("chg:1:v:0")).toEqual({ ownerUserId: 1, action: { kind: "version", versionIndex: 0 } });
  expect(parseChangelogCallbackData("chg:0:v:0")).toBeNull();
  expect(parseChangelogCallbackData("chg:1:v:-1")).toBeNull();
  expect(parseChangelogCallbackData("chg:1:x:0")).toBeNull();
});

test("changelog edits a personal output as an ephemeral message", async () => {
  const bot = new Bot<BotContext>("123:test", { botInfo: { id: 999, is_bot: true, first_name: "FishBot", username: "fishbot" } as never });
  const calls: ApiCall[] = [];
  bot.api.config.use(async (_prev, method, payload) => { calls.push({ method, payload: payload as Record<string, unknown> }); return { ok: true, result: true } as never; });
  registerChangelogCommand(bot);

  await bot.handleUpdate(callbackUpdate("chg:1:v:0", 1, true));

  expect(calls.map((call) => call.method)).toEqual(["editEphemeralMessageText", "answerCallbackQuery"]);
  expect(calls[0]!.payload.ephemeral_message_id).toBe(12);
});
