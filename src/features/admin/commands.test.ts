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
  eventTimeZone: "Europe/Moscow",
  databaseUrl: "postgres://localhost/fishbot_test",
};

function update(text: string, from = ADMIN, replyTo?: User): Update {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: CHAT,
      from: { ...from, is_bot: false } as User,
      text,
      entities: [{ type: "bot_command", offset: 0, length: text.indexOf(" ") === -1 ? text.length : text.indexOf(" ") }],
      reply_to_message:
        replyTo === undefined ? undefined : { message_id: 2, date: 0, chat: CHAT, from: replyTo },
    },
  } as Update;
}

function createBot(messageIds: number[]): {
  bot: Bot<BotContext>;
  deleted: number[];
  requested: Array<number | undefined>;
  replies: string[];
  ephemeralReceiverIds: number[];
  removedFishIds: number[];
  removedRodIds: string[];
  grantedRodIds: string[];
  disabledEventIds: Set<string>;
  commandModes: Map<string, string>;
} {
  const deleted: number[] = [];
  const requested: Array<number | undefined> = [];
  const replies: string[] = [];
  const ephemeralReceiverIds: number[] = [];
  const forgotten: number[] = [];
  const removedFishIds: number[] = [];
  const removedRodIds: string[] = [];
  const grantedRodIds: string[] = [];
  const disabledEventIds = new Set<string>();
  const commandModes = new Map<string, string>();
  const repo = {
    async listRecentClearableMessageIds(_chatId: number, limit?: number) {
      requested.push(limit);
      return messageIds;
    },
    async markChatMessageDeleted(_chatId: number, messageId: number) {
      forgotten.push(messageId);
    },
    async getFisher(userId: number, chatId: number) {
      return userId === 9 && chatId === CHAT.id ? { userId, chatId, firstName: "Игрок", balance: 100 } : null;
    },
    async getInventoryPage() {
      return { fishes: [], page: 1, totalCount: 0, totalValue: 0 };
    },
    async getInventoryFish(_userId: number, _chatId: number, fishId: number) {
      return { id: fishId, name: "Окунь", rarity: "Обычная", point: 1, sizeCm: 30, weightG: 1000, price: 100, fishModifierId: null, fishModifierName: null, fishModifierRarity: null };
    },
    async getEquippedRodId() {
      return "basic";
    },
    async listPurchasedRodIds() {
      return [];
    },
    async listRodCaseBalances() {
      return [];
    },
    async removeInventoryFish(_userId: number, _chatId: number, fishId: number) {
      removedFishIds.push(fishId);
      return true;
    },
    async removePurchasedRod(_userId: number, _chatId: number, rodId: string) {
      removedRodIds.push(rodId);
      return true;
    },
    async grantPurchasedRod(_userId: number, _chatId: number, rodId: string) {
      grantedRodIds.push(rodId);
      return true;
    },
    async sellFish() {
      return { status: "sold" as const, count: 1, total: 100 };
    },
    async listDisabledTimeEventIds() {
      return [...disabledEventIds];
    },
    async setTimeEventDisabled(eventId: string, disabled: boolean) {
      if (disabled) disabledEventIds.add(eventId);
      else disabledEventIds.delete(eventId);
    },
    async getCommandOutputMode(command: string) {
      return commandModes.get(command) ?? "normal";
    },
    async setCommandOutputMode(command: string, mode: string) {
      commandModes.set(command, mode);
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
      const receiverUserId = (payload as { ephemeral_message_parameters?: { receiver_user_id?: number } }).ephemeral_message_parameters?.receiver_user_id;
      if (receiverUserId !== undefined) ephemeralReceiverIds.push(receiverUserId);
      return { ok: true, result: { message_id: 2 } } as never;
    }
    if (method === "editEphemeralMessageText" || method === "editMessageText" || method === "answerCallbackQuery") return { ok: true, result: true } as never;
    throw new Error(`Unexpected API method: ${method}`);
  });
  bot.use(conversations());
  const catalogAccess: CatalogAccess = { async reload() { return []; } };
  registerAdminCommands(bot, CFG, repo, catalogAccess);
  return { bot, deleted, requested, replies, ephemeralReceiverIds, removedFishIds, removedRodIds, grantedRodIds, disabledEventIds, commandModes };
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

describe("/aprofile", () => {
  test("opens a replied player's profile in an admin-bound ephemeral menu", async () => {
    const { bot, replies, deleted } = createBot([]);
    const player = { id: 9, is_bot: false, first_name: "Игрок" } as User;

    await bot.handleUpdate(update("/aprofile", ADMIN, player));

    expect(replies[0]).toContain("Админ-профиль: Игрок");
    expect(replies[0]).toContain("Профиль рыбака");
    expect(deleted).toEqual([1]);
  });

  test("opens fish details before applying an admin action", async () => {
    const { bot, removedFishIds } = createBot([]);
    const callback = (from: User, data: string) => ({
      update_id: 2,
      callback_query: {
        id: "callback",
        from,
        chat_instance: "instance",
        data,
        message: {
          message_id: 3,
          date: 0,
          chat: CHAT,
          from: { id: 99, is_bot: true, first_name: "FishBot" },
          receiver_user: { id: ADMIN.id, is_bot: false, first_name: ADMIN.first_name },
          ephemeral_message_id: 1,
        },
      },
    });

    await bot.handleUpdate(callback({ id: 2, is_bot: false, first_name: "Игрок" }, "ap:9:fd:7") as Update);
    expect(removedFishIds).toEqual([]);
    await bot.handleUpdate(callback({ id: ADMIN.id, is_bot: false, first_name: ADMIN.first_name }, "ap:9:fd:7") as Update);
    expect(removedFishIds).toEqual([]);
    await bot.handleUpdate(callback({ id: ADMIN.id, is_bot: false, first_name: ADMIN.first_name }, "ap:9:rmf:7") as Update);
    expect(removedFishIds).toEqual([7]);
  });

  test("grants an unowned rod from its admin menu", async () => {
    const { bot, grantedRodIds } = createBot([]);
    await bot.handleUpdate({
      update_id: 3,
      callback_query: {
        id: "grant-rod",
        from: { id: ADMIN.id, is_bot: false, first_name: ADMIN.first_name },
        chat_instance: "instance",
        data: "ap:9:grant:carbon",
        message: {
          message_id: 3,
          date: 0,
          chat: CHAT,
          from: { id: 99, is_bot: true, first_name: "FishBot" },
          receiver_user: { id: ADMIN.id, is_bot: false, first_name: ADMIN.first_name },
          ephemeral_message_id: 1,
        },
      },
    } as Update);
    expect(grantedRodIds).toEqual(["carbon"]);
  });
});

describe("/apanel", () => {
  test("opens in a private chat and toggles a validated event", async () => {
    const { bot, replies, ephemeralReceiverIds, disabledEventIds } = createBot([]);
    await bot.handleUpdate({
      update_id: 4,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: ADMIN.id, type: "private", first_name: ADMIN.first_name },
        from: { ...ADMIN, is_bot: false },
        text: "/apanel",
        entities: [{ type: "bot_command", offset: 0, length: 7 }],
      },
    } as Update);
    expect(replies[0]).toContain("Панель администратора");
    expect(replies[0]).not.toContain("Золотой час");
    expect(ephemeralReceiverIds).toEqual([ADMIN.id]);

    await bot.handleUpdate({
      update_id: 5,
      callback_query: {
        id: "open-events",
        from: { ...ADMIN, is_bot: false },
        chat_instance: "instance",
        data: "apn:events",
        message: {
          message_id: 2,
          date: 0,
          chat: CHAT,
          from: { id: 99, is_bot: true, first_name: "FishBot" },
          receiver_user: { id: ADMIN.id, is_bot: false, first_name: ADMIN.first_name },
          ephemeral_message_id: 1,
        },
      },
    } as Update);
    await bot.handleUpdate({
      update_id: 6,
      callback_query: {
        id: "toggle-event",
        from: { ...ADMIN, is_bot: false },
        chat_instance: "instance",
        data: "apn:toggle:golden_hour",
        message: {
          message_id: 2,
          date: 0,
          chat: CHAT,
          from: { id: 99, is_bot: true, first_name: "FishBot" },
          receiver_user: { id: ADMIN.id, is_bot: false, first_name: ADMIN.first_name },
          ephemeral_message_id: 1,
        },
      },
    } as Update);
    expect(disabledEventIds).toEqual(new Set(["golden_hour"]));
  });

  test("does not let non-admin users change event settings", async () => {
    const { bot, disabledEventIds } = createBot([]);
    await bot.handleUpdate({
      update_id: 7,
      callback_query: {
        id: "blocked-toggle",
        from: { id: 2, is_bot: false, first_name: "Игрок" },
        chat_instance: "instance",
        data: "apn:toggle:golden_hour",
        message: {
          message_id: 2,
          date: 0,
          chat: CHAT,
          from: { id: 99, is_bot: true, first_name: "FishBot" },
          receiver_user: { id: ADMIN.id, is_bot: false, first_name: ADMIN.first_name },
          ephemeral_message_id: 1,
        },
      },
    } as Update);
    expect(disabledEventIds).toEqual(new Set());
  });

  test("selects an output mode for a command", async () => {
    const { bot, commandModes } = createBot([]);
    await bot.handleUpdate({
      update_id: 8,
      callback_query: {
        id: "set-command-mode",
        from: { ...ADMIN, is_bot: false },
        chat_instance: "instance",
        data: "apn:cmdmode:fish:personal",
        message: {
          message_id: 2,
          date: 0,
          chat: CHAT,
          from: { id: 99, is_bot: true, first_name: "FishBot" },
          receiver_user: { id: ADMIN.id, is_bot: false, first_name: ADMIN.first_name },
          ephemeral_message_id: 1,
        },
      },
    } as Update);
    expect(commandModes).toEqual(new Map([["fish", "personal"]]));
  });
});
