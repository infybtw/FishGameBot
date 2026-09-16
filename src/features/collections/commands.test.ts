import { describe, expect, test } from "bun:test";
import { Bot } from "grammy";
import type { Chat, Update, User } from "grammy/types";
import type { BotContext } from "../../bot.ts";
import type { CollectionDepositInput, CollectionDepositResult, Repo } from "../../db/index.ts";
import { setCatalog } from "../fishing/catalog.ts";
import { buildCollectionCallbackData } from "./callback-data.ts";
import { registerCollectionCommands } from "./commands.ts";
import { COLLECTIONS_FOREIGN, COLLECTIONS_STALE } from "./messages.ts";

type CommandChat = Extract<Chat, { type: "group" | "supergroup" | "private" }>;
type FixtureUser = { id: number; first_name: string; is_bot?: boolean };
type ApiCall = { method: string; payload: Record<string, unknown> };

const INITIATOR: FixtureUser = { id: 9, first_name: "Иван" };
const FOREIGNER: FixtureUser = { id: 33, first_name: "Чужак" };
const BOT_USER = { id: 999, is_bot: true, first_name: "FishBot" };
const GROUP_CHAT: CommandChat = { id: -100, type: "supergroup", title: "Рыбаки" };
const PRIVATE_CHAT: CommandChat = { id: 7, type: "private", first_name: "Иван" };

const TEST_CATALOG = [
  [
    { name: "Карась", rarity: "Обычная", point: 1 },
    { name: "Окунь", rarity: "Обычная", point: 1 },
  ],
  [{ name: "Щука", rarity: "Редкая", point: 2 }],
];

function toUser(user: FixtureUser): User {
  return { id: user.id, is_bot: user.is_bot ?? false, first_name: user.first_name };
}

function commandUpdate(spec: { updateId: number; text: string; chat?: CommandChat; from?: FixtureUser }): Update {
  const from = toUser(spec.from ?? INITIATOR);
  return {
    update_id: spec.updateId,
    message: {
      message_id: spec.updateId,
      date: 0,
      chat: spec.chat ?? GROUP_CHAT,
      from,
      text: spec.text,
      entities: [{ type: "bot_command" as const, offset: 0, length: spec.text.length }],
    },
  } as Update;
}

/** Menu presses arrive on an ephemeral message bound to its owner. */
function menuCallback(spec: { updateId: number; ownerId: number; pressingId: number; data: string; ephemeral?: boolean }): Update {
  return {
    update_id: spec.updateId,
    callback_query: {
      id: `query-${spec.updateId}`,
      from: toUser({ id: spec.pressingId, first_name: spec.pressingId === FOREIGNER.id ? FOREIGNER.first_name : INITIATOR.first_name }),
      chat_instance: "instance",
      data: spec.data,
      message: {
        message_id: 10,
        date: 1,
        chat: { id: GROUP_CHAT.id, type: "supergroup", title: "Рыбаки" },
        from: BOT_USER,
        text: "🗂 Коллекции",
        ...(spec.ephemeral === false
          ? {}
          : {
              receiver_user: toUser({ id: spec.ownerId, first_name: INITIATOR.first_name }),
              ephemeral_message_id: 20,
            }),
      },
    },
  } as Update;
}

type FakeRepoState = {
  repo: Repo;
  calls: string[];
  counts: Map<string, number>;
  completed: Set<string>;
  deposits: CollectionDepositInput[];
};

function createFakeRepo(): FakeRepoState {
  const calls: string[] = [];
  const counts = new Map<string, number>();
  const completed = new Set<string>();
  const deposits: CollectionDepositInput[] = [];
  const repo = {
    async ensureFisher() {
      calls.push("ensureFisher");
    },
    async listCompletedCollectionIds() {
      calls.push("listCompletedCollectionIds");
      return [...completed].sort();
    },
    async getAvailableCatchCounts() {
      calls.push("getAvailableCatchCounts");
      return [...counts.entries()].filter(([, count]) => count > 0).map(([name, count]) => ({ name, count }));
    },
    async depositCollection(input: CollectionDepositInput): Promise<CollectionDepositResult> {
      calls.push("depositCollection");
      deposits.push(input);
      if (completed.has(input.collectionId)) return { status: "already_completed" };
      const missing = input.required.filter(({ name, count }) => (counts.get(name) ?? 0) < count).map(({ name }) => name);
      if (missing.length > 0) return { status: "missing", missing };
      for (const { name, count } of input.required) counts.set(name, (counts.get(name) ?? 0) - count);
      completed.add(input.collectionId);
      return { status: "completed", deposited: input.required.map(({ name }) => name) };
    },
  } as unknown as Repo;
  return { repo, calls, counts, completed, deposits };
}

function createTestBot(repo: Repo): { bot: Bot<BotContext>; apiCalls: ApiCall[] } {
  const apiCalls: ApiCall[] = [];
  const bot = new Bot<BotContext>("123:test", {
    botInfo: { id: BOT_USER.id, is_bot: true, first_name: "FishBot", username: "fishbot" } as never,
    client: {
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        const method = String(url).split("/").at(-1)!;
        const payload = init?.body === undefined ? {} : (JSON.parse(String(init.body)) as Record<string, unknown>);
        apiCalls.push({ method, payload });
        return new Response(JSON.stringify({ ok: true, result: true }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  });
  registerCollectionCommands(bot, repo);
  return { bot, apiCalls };
}

type InlineMarkup = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };

function sendCalls(apiCalls: ApiCall[]): ApiCall[] {
  return apiCalls.filter((call) => call.method === "sendMessage");
}

function answerCalls(apiCalls: ApiCall[]): ApiCall[] {
  return apiCalls.filter((call) => call.method === "answerCallbackQuery");
}

function editCalls(apiCalls: ApiCall[]): ApiCall[] {
  return apiCalls.filter((call) => call.method === "editEphemeralMessageText");
}

function buttons(apiCall: ApiCall): string[] {
  return (apiCall.payload.reply_markup as InlineMarkup).inline_keyboard.flat().map((button) => button.text);
}

describe("/collections command", () => {
  test("a group invocation opens an owner-bound ephemeral menu and deletes the command", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, calls } = createFakeRepo();
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(commandUpdate({ updateId: 1, text: "/collections" }));

    const sends = sendCalls(apiCalls);
    expect(sends).toHaveLength(1);
    expect(sends[0]!.payload.ephemeral_message_parameters).toEqual({ receiver_user_id: INITIATOR.id });
    const text = String(sends[0]!.payload.text);
    expect(text).toContain("Коллекции");
    expect(text).toContain("Собрано:</b> 0/10");
    expect(buttons(sends[0]!)).toContain("◻️ Обычная коллекция (0/8)");
    expect(calls).toContain("ensureFisher");
    expect(apiCalls).toContainEqual({ method: "deleteMessage", payload: { chat_id: GROUP_CHAT.id, message_id: 1 } });
  });

  test("private invocations are ignored", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, calls } = createFakeRepo();
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(commandUpdate({ updateId: 1, text: "/collections", chat: PRIVATE_CHAT }));

    expect(sendCalls(apiCalls)).toHaveLength(0);
    expect(calls).not.toContain("ensureFisher");
  });
});

describe("collection detail", () => {
  test("shows the missing fish and offers no deposit when incomplete", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, counts } = createFakeRepo();
    counts.set("Карась", 1);
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(
      menuCallback({
        updateId: 1,
        ownerId: INITIATOR.id,
        pressingId: INITIATOR.id,
        data: buildCollectionCallbackData(INITIATOR.id, { kind: "view", collectionId: "rarity_1" }),
      }),
    );

    const edits = editCalls(apiCalls);
    expect(edits).toHaveLength(1);
    const text = String(edits[0]!.payload.text);
    expect(text).toContain("Обычная коллекция");
    expect(text).toContain("❌ Карась 1/4");
    expect(text).toContain("❌ Окунь 0/4");
    expect(buttons(edits[0]!)).toEqual(["← Назад"]);
  });

  test("offers a single deposit when every required copy is present", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, counts } = createFakeRepo();
    counts.set("Карась", 4);
    counts.set("Окунь", 4);
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(
      menuCallback({
        updateId: 1,
        ownerId: INITIATOR.id,
        pressingId: INITIATOR.id,
        data: buildCollectionCallbackData(INITIATOR.id, { kind: "view", collectionId: "rarity_1" }),
      }),
    );

    const markup = editCalls(apiCalls)[0]!.payload.reply_markup as InlineMarkup;
    expect(markup.inline_keyboard.flat().map((button) => button.text)).toEqual(["✅ Сдать всё", "← Назад"]);
    expect(markup.inline_keyboard[0]![0]!.callback_data).toBe(
      buildCollectionCallbackData(INITIATOR.id, { kind: "deposit", collectionId: "rarity_1" }),
    );
  });
});

describe("collection deposit", () => {
  test("completing a collection consumes the fish, announces the buff, and marks it done", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, counts, completed, deposits } = createFakeRepo();
    counts.set("Карась", 4);
    counts.set("Окунь", 5);
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(
      menuCallback({
        updateId: 1,
        ownerId: INITIATOR.id,
        pressingId: INITIATOR.id,
        data: buildCollectionCallbackData(INITIATOR.id, { kind: "deposit", collectionId: "rarity_1" }),
      }),
    );

    expect(deposits).toEqual([
      {
        userId: INITIATOR.id,
        chatId: GROUP_CHAT.id,
        collectionId: "rarity_1",
        required: [
          { name: "Карась", count: 4 },
          { name: "Окунь", count: 4 },
        ],
      },
    ]);
    expect(completed.has("rarity_1")).toBe(true);
    expect(counts.get("Карась")).toBe(0);
    expect(counts.get("Окунь")).toBe(1);
    const sends = sendCalls(apiCalls);
    expect(sends).toHaveLength(1);
    expect(String(sends[0]!.payload.text)).toContain(`<a href="tg://user?id=${INITIATOR.id}">Иван</a>`);
    expect(String(sends[0]!.payload.text)).toContain("собрана");
    expect(String(sends[0]!.payload.text)).toContain("Шанс поймать рыбу: +2 п.п.");
    const edits = editCalls(apiCalls);
    expect(edits).toHaveLength(1);
    expect(String(edits[0]!.payload.text)).toContain("бонус активен");
    expect(buttons(edits[0]!)).toEqual(["← Назад"]);
    expect(answerCalls(apiCalls)[0]!.payload).toMatchObject({ text: "🏆 Коллекция собрана!" });
  });

  test("a missing fish leaves the inventory and collection untouched", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, counts, completed } = createFakeRepo();
    counts.set("Карась", 1);
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(
      menuCallback({
        updateId: 1,
        ownerId: INITIATOR.id,
        pressingId: INITIATOR.id,
        data: buildCollectionCallbackData(INITIATOR.id, { kind: "deposit", collectionId: "rarity_1" }),
      }),
    );

    expect(completed.size).toBe(0);
    expect(counts.get("Карась")).toBe(1);
    expect(sendCalls(apiCalls)).toHaveLength(0);
    const edits = editCalls(apiCalls);
    expect(String(edits[0]!.payload.text)).toContain("Не хватает: Карась, Окунь");
    expect(answerCalls(apiCalls)[0]!.payload).toMatchObject({ show_alert: true });
  });

  test("a foreign press alerts and never deposits", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, calls } = createFakeRepo();
    const { bot, apiCalls } = createTestBot(repo);
    const data = buildCollectionCallbackData(INITIATOR.id, { kind: "deposit", collectionId: "rarity_1" });

    await bot.handleUpdate(menuCallback({ updateId: 1, ownerId: INITIATOR.id, pressingId: FOREIGNER.id, data }));

    expect(answerCalls(apiCalls)[0]!.payload).toMatchObject({ text: COLLECTIONS_FOREIGN, show_alert: true });
    expect(editCalls(apiCalls)).toHaveLength(0);
    expect(calls).not.toContain("depositCollection");
  });

  test("a malformed callback is answered as stale and mutates nothing", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, calls } = createFakeRepo();
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(
      menuCallback({ updateId: 1, ownerId: INITIATOR.id, pressingId: INITIATOR.id, data: "col:16:x" }),
    );

    expect(answerCalls(apiCalls)[0]!.payload).toMatchObject({ text: COLLECTIONS_STALE, show_alert: true });
    expect(calls).not.toContain("depositCollection");
  });

  test("a callback from a public menu is rejected as stale", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, calls } = createFakeRepo();
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(
      menuCallback({
        updateId: 1,
        ownerId: INITIATOR.id,
        pressingId: INITIATOR.id,
        data: buildCollectionCallbackData(INITIATOR.id, { kind: "view", collectionId: "rarity_1" }),
        ephemeral: false,
      }),
    );

    expect(answerCalls(apiCalls)[0]!.payload).toMatchObject({ text: COLLECTIONS_STALE, show_alert: true });
    expect(calls).not.toContain("getAvailableCatchCounts");
  });
});
