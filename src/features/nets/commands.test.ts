import { afterEach, expect, jest, spyOn, test } from "bun:test";
import { Bot } from "grammy";
import type { Chat, Update, User } from "grammy/types";
import type { BotContext } from "../../bot.ts";
import type { FishingNetRow, FishingNetCollectResult, Repo } from "../../db/index.ts";
import { setCatalog } from "../fishing/catalog.ts";
import { NET_DURATION_SECONDS } from "./net.ts";
import { buildNetCallbackData } from "./callback-data.ts";
import { registerNetCommands } from "./commands.ts";

type CommandChat = Extract<Chat, { type: "group" | "supergroup" | "private" }>;
type FixtureUser = { id: number; first_name: string; is_bot?: boolean };
type ApiCall = { method: string; payload: Record<string, unknown> };

const OWNER: FixtureUser = { id: 9, first_name: "Игрок" };
const FOREIGNER: FixtureUser = { id: 22, first_name: "Чужак" };
const GROUP_CHAT: CommandChat = { id: -100, type: "supergroup", title: "Рыбаки" };
const SECOND_CHAT: CommandChat = { id: -200, type: "supergroup", title: "Спиннинг" };
const PRIVATE_CHAT: CommandChat = { id: 7, type: "private", first_name: "Рыбак" };

const FULL_CATALOG = [
  [{ name: "Окунь", rarity: "Обычный", point: 1 }],
  [{ name: "Лещ", rarity: "Редкий", point: 2 }],
  [{ name: "Карп", rarity: "Эпический", point: 3 }],
  [{ name: "Сом", rarity: "Легендарный", point: 4 }],
  [{ name: "Акула", rarity: "Мифическая", point: 5 }],
  [{ name: "Кит", rarity: "Радужная", point: 6 }],
];

type CommandUpdateSpec = { updateId: number; text: string; chat?: CommandChat; from?: FixtureUser };
function commandUpdate(spec: CommandUpdateSpec): Update {
  const chat = spec.chat ?? GROUP_CHAT;
  const from = toUser(spec.from ?? OWNER);
  return {
    update_id: spec.updateId,
    message: {
      message_id: spec.updateId,
      date: 0,
      chat,
      from,
      text: spec.text,
      entities: [{ type: "bot_command" as const, offset: 0, length: spec.text.length }],
    },
  } as Update;
}

function toUser(user: FixtureUser): User {
  return { id: user.id, is_bot: user.is_bot ?? false, first_name: user.first_name };
}

function callbackUpdate(spec: {
  updateId: number;
  ownerId: number;
  pressingUserId: number;
  data: string;
  chatId?: number;
  ephemeral?: boolean;
}): Update {
  const chatId = spec.chatId ?? GROUP_CHAT.id;
  return {
    update_id: spec.updateId,
    callback_query: {
      id: `query-${spec.updateId}`,
      from: toUser({ id: spec.pressingUserId, first_name: "Игрок" }),
      chat_instance: "instance",
      data: spec.data,
      message: {
        message_id: 10,
        date: 1,
        chat: { id: chatId, type: "supergroup", title: "Рыбаки" },
        from: { id: 999, is_bot: true, first_name: "FishBot" },
        text: "Меню сети",
        ...(spec.ephemeral === false
          ? {}
          : {
              receiver_user: { id: spec.ownerId, is_bot: false, first_name: "Игрок" },
              ephemeral_message_id: 20,
            }),
      },
    },
  } as Update;
}

type FakeNet = FishingNetRow;

function createNetRepo(): {
  repo: Repo;
  calls: string[];
  nets: Map<string, FakeNet>;
  catches: Array<{ userId: number; chatId: number; fishName: string }>;
  collectScript: FishingNetCollectResult[];
} {
  const calls: string[] = [];
  const nets = new Map<string, FakeNet>();
  const catches: Array<{ userId: number; chatId: number; fishName: string }> = [];
  const collectScript: FishingNetCollectResult[] = [];
  const key = (userId: number, chatId: number) => `${userId}:${chatId}`;
  const repo = {
    async ensureFisher(_userId: number, _chatId: number, _firstName: string) {
      calls.push("ensureFisher");
    },
    async getFishingNet(userId: number, chatId: number) {
      calls.push("getFishingNet");
      return nets.get(key(userId, chatId)) ?? null;
    },
    async castFishingNet(userId: number, chatId: number, firstName: string, castAt: number) {
      calls.push("castFishingNet");
      const existing = nets.get(key(userId, chatId));
      if (existing !== undefined) return existing.castAt;
      nets.set(key(userId, chatId), { userId, chatId, firstName, castAt, readyNotifiedAt: null });
      return castAt;
    },
    async collectFishingNet(
      userId: number,
      chatId: number,
      now: number,
      inserts: Array<{ userId: number; chatId: number; fishName: string }>,
    ) {
      calls.push("collectFishingNet");
      if (collectScript.length > 0) return collectScript.shift()!;
      const net = nets.get(key(userId, chatId));
      if (net === undefined) return { status: "not_cast" } satisfies FishingNetCollectResult;
      if (net.castAt + NET_DURATION_SECONDS > now) {
        return { status: "not_ready", castAt: net.castAt } satisfies FishingNetCollectResult;
      }
      for (const insert of inserts) catches.push(insert);
      nets.delete(key(userId, chatId));
      return { status: "collected", castAt: net.castAt } satisfies FishingNetCollectResult;
    },
  } as unknown as Repo;
  return { repo, calls, nets, catches, collectScript };
}

function createTestBot(repo: Repo): { bot: Bot<BotContext>; apiCalls: ApiCall[] } {
  const bot = new Bot<BotContext>("123:test", {
    botInfo: { id: 999, is_bot: true, first_name: "FishBot", username: "fishbot" } as never,
  });
  const apiCalls: ApiCall[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    apiCalls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: true } as never;
  });
  registerNetCommands(bot, repo);
  return { bot, apiCalls };
}

function mockNow(unixSeconds: number): void {
  spyOn(Date, "now").mockReturnValue(unixSeconds * 1000);
}

/** Consumes the given values, then answers every further draw with 0.5 (deterministic beta tail). */
function mockRandom(values: readonly number[]): void {
  let index = 0;
  spyOn(Math, "random").mockImplementation(() => values[index++] ?? 0.5);
}

function answerCalls(apiCalls: ApiCall[]): ApiCall[] {
  return apiCalls.filter((call) => call.method === "answerCallbackQuery");
}

function editCalls(apiCalls: ApiCall[]): ApiCall[] {
  return apiCalls.filter((call) => call.method === "editEphemeralMessageText");
}

function sendCalls(apiCalls: ApiCall[]): ApiCall[] {
  return apiCalls.filter((call) => call.method === "sendMessage");
}

afterEach(() => {
  setCatalog([]);
  jest.restoreAllMocks();
});

test("/net in a group opens an owner-bound menu and initializes the fisher", async () => {
  setCatalog(FULL_CATALOG);
  const { repo, nets, calls } = createNetRepo();
  const { bot, apiCalls } = createTestBot(repo);
  mockNow(5_000_000);

  await bot.handleUpdate(commandUpdate({ updateId: 1, text: "/net" }));

  expect(calls).toEqual(["ensureFisher", "getFishingNet"]);
  expect(sendCalls(apiCalls)).toHaveLength(1);
  const send = sendCalls(apiCalls)[0]!.payload;
  expect(send.chat_id).toBe(GROUP_CHAT.id);
  expect(send.ephemeral_message_parameters).toEqual({ receiver_user_id: OWNER.id });
  expect(String(send.text)).toContain("Рыбацкая сеть");
  expect(JSON.stringify(send.reply_markup)).toContain("Закинуть сеть");
  expect(JSON.stringify(send.reply_markup)).toContain(buildNetCallbackData(OWNER.id, { kind: "cast" }));
  expect(nets.size).toBe(0);
});

test("/net is ignored in private chats", async () => {
  const { repo, calls } = createNetRepo();
  const { bot, apiCalls } = createTestBot(repo);

  await bot.handleUpdate(commandUpdate({ updateId: 2, text: "/net", chat: PRIVATE_CHAT }));

  expect(calls).toEqual([]);
  expect(apiCalls).toEqual([]);
});

test("/net renders the ready state for a ripened net", async () => {
  setCatalog(FULL_CATALOG);
  const { repo, nets } = createNetRepo();
  const { bot, apiCalls } = createTestBot(repo);
  const castAt = 5_000_000 - NET_DURATION_SECONDS;
  nets.set(`${OWNER.id}:${GROUP_CHAT.id}`, { userId: OWNER.id, chatId: GROUP_CHAT.id, firstName: OWNER.first_name, castAt, readyNotifiedAt: null });
  mockNow(5_000_000);

  await bot.handleUpdate(commandUpdate({ updateId: 3, text: "/net" }));

  const text = String(sendCalls(apiCalls)[0]!.payload.text);
  expect(text).toContain("Сеть готова");
  expect(JSON.stringify(sendCalls(apiCalls)[0]!.payload.reply_markup)).toContain("Забрать сеть");
});

test("a cast stores the current timestamp only for that user and chat", async () => {
  setCatalog(FULL_CATALOG);
  const { repo, nets, calls } = createNetRepo();
  const { bot, apiCalls } = createTestBot(repo);
  const now = 5_000_000;
  mockNow(now);

  await bot.handleUpdate(
    callbackUpdate({ updateId: 4, ownerId: OWNER.id, pressingUserId: OWNER.id, data: buildNetCallbackData(OWNER.id, { kind: "cast" }) }),
  );

  expect(calls).toEqual(["castFishingNet", "getFishingNet"]);
  expect(nets.get(`${OWNER.id}:${GROUP_CHAT.id}`)?.castAt).toBe(now);
  expect(nets.size).toBe(1);
  const text = String(editCalls(apiCalls)[0]!.payload.text);
  expect(text).toContain("Сеть заброшена");
  expect(text).toContain("12часов 0минут 0секунд");
  expect(JSON.stringify(editCalls(apiCalls)[0]!.payload.reply_markup)).toContain("Забрать сеть");
  expect(answerCalls(apiCalls)).toHaveLength(1);
});

test("foreign and replayed net callbacks cannot mutate net state", async () => {
  setCatalog(FULL_CATALOG);
  const { repo, nets } = createNetRepo();
  const { bot, apiCalls } = createTestBot(repo);
  const data = buildNetCallbackData(OWNER.id, { kind: "cast" });

  await bot.handleUpdate(callbackUpdate({ updateId: 5, ownerId: OWNER.id, pressingUserId: FOREIGNER.id, data }));
  expect(nets.size).toBe(0);
  expect(answerCalls(apiCalls)).toEqual([
    expect.objectContaining({ payload: expect.objectContaining({ show_alert: true, text: "Это меню принадлежит другому игроку." }) }),
  ]);

  apiCalls.length = 0;
  await bot.handleUpdate(
    callbackUpdate({ updateId: 6, ownerId: OWNER.id, pressingUserId: OWNER.id, data, ephemeral: false }),
  );
  expect(nets.size).toBe(0);
  expect(answerCalls(apiCalls)).toEqual([
    expect.objectContaining({ payload: expect.objectContaining({ show_alert: true, text: "Кнопка устарела. Откройте /net заново." }) }),
  ]);
});

test("collecting one second early reports the remaining time without recording catches", async () => {
  setCatalog(FULL_CATALOG);
  const { repo, nets, catches, calls } = createNetRepo();
  const { bot, apiCalls } = createTestBot(repo);
  const castAt = 5_000_000;
  nets.set(`${OWNER.id}:${GROUP_CHAT.id}`, { userId: OWNER.id, chatId: GROUP_CHAT.id, firstName: OWNER.first_name, castAt, readyNotifiedAt: null });
  mockNow(castAt + NET_DURATION_SECONDS - 1);

  await bot.handleUpdate(
    callbackUpdate({ updateId: 7, ownerId: OWNER.id, pressingUserId: OWNER.id, data: buildNetCallbackData(OWNER.id, { kind: "collect" }) }),
  );

  expect(calls).toEqual(["getFishingNet"]);
  expect(answerCalls(apiCalls)).toEqual([
    expect.objectContaining({
      payload: expect.objectContaining({ text: "Ещё нельзя забрать сеть. Осталось: 0часов 0минут 1секунд." }),
    }),
  ]);
  expect(catches).toHaveLength(0);
  expect(nets.size).toBe(1);
  expect(editCalls(apiCalls)).toHaveLength(0);
});

test("collecting exactly at the deadline awards one fish, deletes the net, and resists a replay", async () => {
  setCatalog(FULL_CATALOG);
  const { repo, nets, catches, calls } = createNetRepo();
  const { bot, apiCalls } = createTestBot(repo);
  const castAt = 5_000_000;
  mockNow(castAt);
  await repo.castFishingNet(OWNER.id, GROUP_CHAT.id, OWNER.first_name, castAt);
  mockNow(castAt + NET_DURATION_SECONDS);
  // Count roll lands on the inclusive minimum: exactly one fish.
  mockRandom([0]);

  await bot.handleUpdate(
    callbackUpdate({ updateId: 8, ownerId: OWNER.id, pressingUserId: OWNER.id, data: buildNetCallbackData(OWNER.id, { kind: "collect" }) }),
  );

  expect(calls).toEqual([
    "castFishingNet",
    "getFishingNet",
    "collectFishingNet",
    "getFishingNet",
  ]);
  expect(catches).toHaveLength(1);
  expect(catches[0]).toMatchObject({ userId: OWNER.id, chatId: GROUP_CHAT.id, fishName: "Окунь" });
  expect(nets.size).toBe(0);
  const editText = String(editCalls(apiCalls)[0]!.payload.text);
  expect(editText).toContain("Улов из сети: Окунь (Обычный).");
  expect(editText).toContain("базовая сеть");
  expect(answerCalls(apiCalls).at(-1)!.payload.text).toBe("Сеть забрана: 1 шт.");

  // Replay after collection: redraw available state, no further fish.
  apiCalls.length = 0;
  calls.length = 0;
  await bot.handleUpdate(
    callbackUpdate({ updateId: 9, ownerId: OWNER.id, pressingUserId: OWNER.id, data: buildNetCallbackData(OWNER.id, { kind: "collect" }) }),
  );
  expect(calls).toEqual(["getFishingNet", "getFishingNet"]);
  expect(catches).toHaveLength(1);
  expect(editCalls(apiCalls)).toHaveLength(1);
  expect(answerCalls(apiCalls)[0]!.payload.text).toBe("Сеть уже забрана.");
});

test("collecting at the boundary can award the full six fish in one chat", async () => {
  setCatalog(FULL_CATALOG);
  const { repo, nets, catches } = createNetRepo();
  const { bot } = createTestBot(repo);
  const castAt = 5_000_000;
  mockNow(castAt);
  await repo.castFishingNet(OWNER.id, GROUP_CHAT.id, OWNER.first_name, castAt);
  mockNow(castAt + NET_DURATION_SECONDS);
  // Count roll lands on the inclusive maximum: six fish.
  mockRandom([0.999_999_999_999_999_9]);

  await bot.handleUpdate(
    callbackUpdate({ updateId: 10, ownerId: OWNER.id, pressingUserId: OWNER.id, data: buildNetCallbackData(OWNER.id, { kind: "collect" }) }),
  );

  expect(catches).toHaveLength(6);
  for (const fish of catches) {
    expect(fish.userId).toBe(OWNER.id);
    expect(fish.chatId).toBe(GROUP_CHAT.id);
  }
  expect(nets.size).toBe(0);
});

test("nets in different groups stay independent for the same user", async () => {
  setCatalog(FULL_CATALOG);
  const { repo, nets } = createNetRepo();
  const { bot } = createTestBot(repo);
  const castAt = 5_000_000;
  mockNow(castAt);
  await repo.castFishingNet(OWNER.id, GROUP_CHAT.id, OWNER.first_name, castAt);
  mockNow(castAt + 5);
  await repo.castFishingNet(OWNER.id, SECOND_CHAT.id, OWNER.first_name, castAt + 5);
  mockNow(castAt + NET_DURATION_SECONDS);
  mockRandom([0]);

  await bot.handleUpdate(
    callbackUpdate({
      updateId: 11,
      ownerId: OWNER.id,
      pressingUserId: OWNER.id,
      data: buildNetCallbackData(OWNER.id, { kind: "collect" }),
      chatId: GROUP_CHAT.id,
    }),
  );

  expect(nets.has(`${OWNER.id}:${GROUP_CHAT.id}`)).toBe(false);
  expect(nets.get(`${OWNER.id}:${SECOND_CHAT.id}`)?.castAt).toBe(castAt + 5);
});

test("a raced collection repeats the early answer and grants no fish", async () => {
  setCatalog(FULL_CATALOG);
  const { repo, nets, catches, collectScript } = createNetRepo();
  const { bot, apiCalls } = createTestBot(repo);
  const castAt = 5_000_000;
  nets.set(`${OWNER.id}:${GROUP_CHAT.id}`, { userId: OWNER.id, chatId: GROUP_CHAT.id, firstName: OWNER.first_name, castAt, readyNotifiedAt: null });
  mockNow(castAt + NET_DURATION_SECONDS);
  mockRandom([0]);
  collectScript.push({ status: "not_ready", castAt });

  await bot.handleUpdate(
    callbackUpdate({ updateId: 12, ownerId: OWNER.id, pressingUserId: OWNER.id, data: buildNetCallbackData(OWNER.id, { kind: "collect" }) }),
  );

  expect(answerCalls(apiCalls)).toEqual([
    expect.objectContaining({
      payload: expect.objectContaining({ text: "Ещё нельзя забрать сеть. Осталось: 0часов 0минут 0секунд." }),
    }),
  ]);
  expect(catches).toHaveLength(0);
  expect(nets.size).toBe(1);
  expect(editCalls(apiCalls)).toHaveLength(0);
});

test("collection is refused without a weighted template and the net stays cast", async () => {
  setCatalog([[], [], [], [], [], []]);
  const { repo, nets, catches } = createNetRepo();
  const { bot, apiCalls } = createTestBot(repo);
  const castAt = 5_000_000;
  nets.set(`${OWNER.id}:${GROUP_CHAT.id}`, { userId: OWNER.id, chatId: GROUP_CHAT.id, firstName: OWNER.first_name, castAt, readyNotifiedAt: null });
  mockNow(castAt + NET_DURATION_SECONDS);

  await bot.handleUpdate(
    callbackUpdate({ updateId: 13, ownerId: OWNER.id, pressingUserId: OWNER.id, data: buildNetCallbackData(OWNER.id, { kind: "collect" }) }),
  );

  expect(answerCalls(apiCalls)).toEqual([
    expect.objectContaining({ payload: expect.objectContaining({ show_alert: true, text: "Сейчас нельзя забрать сеть: в списке рыб нет подходящих рыб." }) }),
  ]);
  expect(catches).toHaveLength(0);
  expect(nets.size).toBe(1);
  expect(editCalls(apiCalls)).toHaveLength(0);
});
