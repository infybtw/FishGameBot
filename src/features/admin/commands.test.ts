import { describe, expect, test } from "bun:test";
import { conversations } from "@grammyjs/conversations";
import { Bot } from "grammy";
import type { Chat, Update, User } from "grammy/types";
import type { BotContext, CatalogAccess } from "../../bot.ts";
import type { Config } from "../../config.ts";
import type { Repo } from "../../db/index.ts";
import { registerAdminCommands } from "./commands.ts";

const ADMIN = { id: 1, first_name: "Админ" };
const CHAT: Extract<Chat, { type: "group" }> = { id: -100, type: "group", title: "Рыбаки" };
const CFG: Config = {
  botToken: "0:test",
  adminUserId: ADMIN.id,
  catchSuccessChance: 50,
  catchDelaySeconds: 0,
  curseDropChance: 0,
  fishModifierDropChance: 0,
  databaseUrl: "postgres://localhost/fishbot_test",
};

function update(text: string, from = ADMIN): Update {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: CHAT,
      from: { ...from, is_bot: false } as User,
      text,
      entities: [{ type: "bot_command", offset: 0, length: text.indexOf(" ") === -1 ? text.length : text.indexOf(" ") }],
    },
  } as Update;
}

function createBot(messageIds: number[]): {
  bot: Bot<BotContext>;
  deleted: number[];
  requested: Array<number | undefined>;
  replies: string[];
} {
  const deleted: number[] = [];
  const requested: Array<number | undefined> = [];
  const replies: string[] = [];
  const forgotten: number[] = [];
  const repo = {
    async listRecentClearableMessageIds(_chatId: number, limit?: number) {
      requested.push(limit);
      return messageIds;
    },
    async markChatMessageDeleted(_chatId: number, messageId: number) {
      forgotten.push(messageId);
    },
  } as unknown as Repo;
  const bot = new Bot<BotContext>(CFG.botToken, {
    botInfo: {
      id: 99,
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
  bot.api.config.use(async (_prev, method, payload) => {
    if (method === "deleteMessage") {
      deleted.push((payload as { message_id: number }).message_id);
      return { ok: true, result: true } as never;
    }
    if (method === "sendMessage") {
      replies.push((payload as { text: string }).text);
      return { ok: true, result: { message_id: 2 } } as never;
    }
    throw new Error(`Unexpected API method: ${method}`);
  });
  bot.use(conversations());
  const catalogAccess: CatalogAccess = { async reload() { return []; } };
  registerAdminCommands(bot, CFG, repo, catalogAccess);
  return { bot, deleted, requested, replies };
}

describe("/cclear", () => {
  test("removes every tracked bot message when no limit is supplied", async () => {
    const { bot, deleted, requested, replies } = createBot([30, 29, 28]);

    await bot.handleUpdate(update("/cclear"));

    expect(requested).toEqual([undefined]);
    expect(deleted).toEqual([30, 29, 28]);
    expect(replies).toEqual(["Удалено сообщений и команд: 3"]);
  });

  test("passes the requested positive limit to the repository", async () => {
    const { bot, deleted, requested } = createBot([30, 29]);

    await bot.handleUpdate(update("/cclear 5"));

    expect(requested).toEqual([5]);
    expect(deleted).toEqual([30, 29]);
  });

  test("does not allow non-admin users to delete messages", async () => {
    const { bot, deleted, requested } = createBot([30]);

    await bot.handleUpdate(update("/cclear", { id: 2, first_name: "Игрок" }));

    expect(requested).toEqual([]);
    expect(deleted).toEqual([]);
  });
});
