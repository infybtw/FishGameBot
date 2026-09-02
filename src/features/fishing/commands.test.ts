import { afterEach, expect, test } from "bun:test";
import { Bot } from "grammy";
import type { Chat, Update } from "grammy/types";
import type { BotContext } from "../../bot.ts";
import type { Config } from "../../config.ts";
import type { Repo } from "../../db/index.ts";
import { getCatalog, setCatalog } from "./catalog.ts";
import { registerGroupCommands } from "./commands.ts";

type CommandChat = Extract<Chat, { type: "group" | "private" | "supergroup" }>;

const CFG: Config = {
  botToken: "0:test",
  adminUserId: 1,
  catchSuccessChance: 50,
  catchDelaySeconds: 0,
  databaseUrl: "postgres://localhost/fishbot_test",
};

function commandUpdate(updateId: number, chat: CommandChat): Update {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat,
      from: { id: 7, is_bot: false, first_name: "Рыбак" },
      text: "/fishes",
      entities: [{ type: "bot_command", offset: 0, length: 7 }],
    },
  };
}

function createTestBot(): { bot: Bot<BotContext>; sentTexts: string[] } {
  const bot = new Bot<BotContext>(CFG.botToken, {
    botInfo: {
      id: 42,
      is_bot: true,
      first_name: "FishBot",
      username: "fish_test_bot",
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    },
  });
  const sentTexts: string[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    if (method !== "sendMessage") throw new Error(`Unexpected API method: ${method}`);
    const message = payload as { chat_id: number | string; text: string };
    sentTexts.push(message.text);
    return {
      ok: true,
      result: {
        message_id: sentTexts.length,
        date: 0,
        chat: { id: Number(message.chat_id), type: "group", title: "Тест" },
        text: message.text,
      },
    } as never;
  });
  registerGroupCommands(bot, CFG, {} as Repo);
  return { bot, sentTexts };
}

afterEach(() => setCatalog([]));

test("/fishes lists escaped fish names, rarities, and normalized catch chances in a group", async () => {
  setCatalog([
    [
      { name: "Окунь & <лещ>", rarity: "Обычный", point: 1 },
      { name: "Карась", rarity: "Обычный", point: 1 },
    ],
    [],
    [{ name: "Сом", rarity: "Эпический", point: 3 }],
  ]);
  const { bot, sentTexts } = createTestBot();

  await bot.handleUpdate(commandUpdate(1, { id: -100, type: "group", title: "Рыбаки" }));

  expect(sentTexts).toEqual([
    "🐟 <b>Список рыб</b>\n" +
      "<i>Шанс указан среди успешных уловов.</i>\n\n" +
      "• <b>Окунь &amp; &lt;лещ&gt;</b> — Обычный — 46.15%\n" +
      "• <b>Карась</b> — Обычный — 46.15%\n" +
      "• <b>Сом</b> — Эпический — 7.69%",
  ]);
  expect(getCatalog()).toHaveLength(3);
});

test("/fishes is ignored in private chats", async () => {
  setCatalog([[{ name: "Окунь", rarity: "Обычный", point: 1 }]]);
  const { bot, sentTexts } = createTestBot();

  await bot.handleUpdate(commandUpdate(2, { id: 7, type: "private", first_name: "Рыбак" }));

  expect(sentTexts).toEqual([]);
});
