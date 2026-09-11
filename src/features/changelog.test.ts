import { expect, test } from "bun:test";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import type { BotContext } from "../bot.ts";
import { CHANGELOG_TEXT, registerChangelogCommand } from "./changelog.ts";

test("/changelog sends updates for the latest three versions", async () => {
  const bot = new Bot<BotContext>("123:test", {
    botInfo: { id: 999, is_bot: true, first_name: "FishBot", username: "fishbot" } as never,
  });
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: true } as never;
  });
  registerChangelogCommand(bot);

  await bot.handleUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: -100, type: "supergroup", title: "Рыбаки" },
      from: { id: 1, is_bot: false, first_name: "Игрок" },
      text: "/changelog",
      entities: [{ type: "bot_command", offset: 0, length: 10 }],
    },
  } as Update);

  expect(calls).toEqual([{ method: "sendMessage", payload: { chat_id: -100, text: CHANGELOG_TEXT } }]);
  expect(CHANGELOG_TEXT).toContain("v0.5.5");
  expect(CHANGELOG_TEXT).toContain("v0.5.4");
  expect(CHANGELOG_TEXT).toContain("v0.5.3");
});
