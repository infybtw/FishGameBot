import { expect, test } from "bun:test";
import { Bot } from "grammy";
import { trackBotMessages } from "./bot.ts";
import type { Repo } from "./db/index.ts";

test("records successful outgoing bot messages", async () => {
  const tracked: Array<[number, number, number | null, boolean, boolean, string | null]> = [];
  const repo = {
    async trackChatMessage(
      chatId: number,
      messageId: number,
      senderUserId: number | null,
      isBot: boolean,
      isCommand: boolean,
      messageText: string | null,
    ) {
      tracked.push([chatId, messageId, senderUserId, isBot, isCommand, messageText]);
    },
  } as unknown as Repo;
  const bot = new Bot("0:test");
  bot.api.config.use(async (_prev, method) => {
    if (method !== "sendMessage") throw new Error(`Unexpected API method: ${method}`);
    return { ok: true, result: { message_id: 42, from: { id: 99 } } } as never;
  });
  bot.api.config.use(trackBotMessages(repo) as never);

  await bot.api.sendMessage(-100, "Тест");

  expect(tracked).toEqual([[-100, 42, 99, true, false, "Тест"]]);
});
