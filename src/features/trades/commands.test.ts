import { describe, expect, test } from "bun:test";
import { Bot } from "grammy";
import type { Chat, Update, User } from "grammy/types";
import type { BotContext } from "../../bot.ts";
import type {
  AcceptTradeResult,
  CreateTradeResult,
  DeclineTradeResult,
  InventoryPage,
  Repo,
  TradeFishDetails,
  TradeInsert,
  TradeRow,
} from "../../db/index.ts";
import { conversations } from "@grammyjs/conversations";
import { buildMenuCallbackData, buildPublicCallbackData } from "./callback-data.ts";
import { registerTradeCommands, parseMoneyAmount } from "./commands.ts";
import { INITIATOR_FISH_EMPTY, MONEY_INVALID, TRADE_USAGE } from "./messages.ts";

type CommandChat = Extract<Chat, { type: "group" | "supergroup" | "private" }>;
type FixtureUser = { id: number; first_name: string; is_bot?: boolean };
type ApiCall = { method: string; payload: Record<string, unknown> };

const INITIATOR: FixtureUser = { id: 9, first_name: "Иван" };
const TARGET: FixtureUser = { id: 22, first_name: "Аня" };
const FOREIGNER: FixtureUser = { id: 33, first_name: "Чужак" };
const BOT_USER = { id: 999, is_bot: true, first_name: "FishBot" };
const GROUP_CHAT: CommandChat = { id: -100, type: "supergroup", title: "Рыбаки" };
const SECOND_CHAT: CommandChat = { id: -200, type: "supergroup", title: "Спиннинг" };
const PRIVATE_CHAT: CommandChat = { id: 7, type: "private", first_name: "Иван" };

const FOREIGN_MENU_ALERT = "Это меню принадлежит другому игроку.";
const STALE_MENU_ALERT = "Кнопка устарела. Откройте /trade заново.";
const FOREIGN_TRADE_ALERT = "Этот обмен адресован не вам.";

function toUser(user: FixtureUser): User {
  return { id: user.id, is_bot: user.is_bot ?? false, first_name: user.first_name };
}

function commandUpdate(spec: {
  updateId: number;
  text: string;
  chat?: CommandChat;
  from?: FixtureUser;
  replyTo?: FixtureUser;
}): Update {
  const chat = spec.chat ?? GROUP_CHAT;
  const from = toUser(spec.from ?? INITIATOR);
  return {
    update_id: spec.updateId,
    message: {
      message_id: spec.updateId,
      date: 0,
      chat,
      from,
      text: spec.text,
      entities: [{ type: "bot_command" as const, offset: 0, length: spec.text.length }],
      ...(spec.replyTo === undefined
        ? {}
        : {
            reply_to_message: {
              message_id: 5,
              date: 0,
              chat,
              from: toUser(spec.replyTo),
              text: "привет",
            },
          }),
    },
  } as Update;
}

function textUpdate(spec: { updateId: number; text: string; from: FixtureUser; chat?: CommandChat }): Update {
  return {
    update_id: spec.updateId,
    message: {
      message_id: spec.updateId,
      date: 0,
      chat: spec.chat ?? GROUP_CHAT,
      from: toUser(spec.from),
      text: spec.text,
    },
  } as Update;
}

const FIXTURE_USERS = [INITIATOR, TARGET, FOREIGNER];

function fixtureName(userId: number): string {
  return FIXTURE_USERS.find((user) => user.id === userId)?.first_name ?? "Игрок";
}

/** Builder presses arrive on an ephemeral, owner-bound menu message. */
function builderCallback(spec: {
  updateId: number;
  ownerId: number;
  targetId: number;
  pressingId: number;
  data: string;
  ephemeral?: boolean;
}): Update {
  return {
    update_id: spec.updateId,
    callback_query: {
      id: `query-${spec.updateId}`,
      from: toUser({ id: spec.pressingId, first_name: fixtureName(spec.pressingId) }),
      chat_instance: "instance",
      data: spec.data,
      message: {
        message_id: 10,
        date: 1,
        chat: { id: GROUP_CHAT.id, type: "supergroup", title: "Рыбаки" },
        from: BOT_USER,
        text: "🎣 Обмен",
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

/** Public presses arrive on the normal group offer message. */
function publicCallback(spec: { updateId: number; pressingId: number; data: string; chatId?: number }): Update {
  return {
    update_id: spec.updateId,
    callback_query: {
      id: `query-${spec.updateId}`,
      from: toUser({ id: spec.pressingId, first_name: "Игрок" }),
      chat_instance: "instance",
      data: spec.data,
      message: {
        message_id: 77,
        date: 1,
        chat: { id: spec.chatId ?? GROUP_CHAT.id, type: "supergroup", title: "Рыбаки" },
        from: BOT_USER,
        text: "🤝 Предложение обмена",
      },
    },
  } as Update;
}

type FakeFish = {
  id: number;
  userId: number;
  chatId: number;
  name: string;
  rarity: string;
  point: number;
  weightG: number;
  sizeCm: number;
  price: number;
  state: "available" | "sold" | "spent" | "removed";
  ownerName: string;
};

type FakeFisher = { userId: number; chatId: number; firstName: string; balance: number };

type FakeRepoState = {
  repo: Repo;
  calls: string[];
  fishes: Map<number, FakeFish>;
  fishers: Map<string, FakeFisher>;
  trades: Map<number, TradeRow>;
};

function createFakeRepo(): FakeRepoState {
  const calls: string[] = [];
  const fishes = new Map<number, FakeFish>();
  const fishers = new Map<string, FakeFisher>();
  const trades = new Map<number, TradeRow>();
  let nextTradeId = 1;
  const fisherKey = (userId: number, chatId: number) => `${userId}:${chatId}`;
  const details = (fish: FakeFish): TradeFishDetails => ({
    id: fish.id,
    name: fish.name,
    rarity: fish.rarity,
    point: fish.point,
    price: fish.price,
  });

  const repo = {
    async ensureFisher(userId: number, chatId: number, firstName: string) {
      calls.push("ensureFisher");
      if (!fishers.has(fisherKey(userId, chatId))) {
        fishers.set(fisherKey(userId, chatId), { userId, chatId, firstName, balance: 0 });
      }
    },
    async getFisher(userId: number, chatId: number) {
      calls.push("getFisher");
      return fishers.get(fisherKey(userId, chatId)) ?? null;
    },
    async getInventoryPage(userId: number, chatId: number, page: number, pageSize: number): Promise<InventoryPage> {
      calls.push("getInventoryPage");
      const available = [...fishes.values()]
        .filter((fish) => fish.userId === userId && fish.chatId === chatId && fish.state === "available")
        .sort((a, b) => b.id - a.id);
      const totalCount = available.length;
      const totalValue = available.reduce((sum, fish) => sum + fish.price, 0);
      const lastPage = Math.max(1, Math.ceil(totalCount / pageSize));
      const currentPage = Math.min(Math.max(1, page), lastPage);
      return {
        fishes: available
          .slice((currentPage - 1) * pageSize, currentPage * pageSize)
          .map(({ id, name, rarity, point, sizeCm, weightG, price }) => ({ id, name, rarity, point, sizeCm, weightG, price })),
        page: currentPage,
        totalCount,
        totalValue,
      };
    },
    async createTrade(insert: TradeInsert): Promise<CreateTradeResult> {
      calls.push("createTrade");
      const requested = fishes.get(insert.requestedFishId);
      if (
        requested === undefined ||
        requested.state !== "available" ||
        requested.userId !== insert.targetUserId ||
        requested.chatId !== insert.chatId
      ) {
        return { status: "stale" };
      }
      let offer: TradeRow["offer"];
      if (insert.offer.kind === "fish") {
        if (insert.offer.offeredFishId === insert.requestedFishId) return { status: "stale" };
        const offered = fishes.get(insert.offer.offeredFishId);
        if (
          offered === undefined ||
          offered.state !== "available" ||
          offered.userId !== insert.initiatorUserId ||
          offered.chatId !== insert.chatId
        ) {
          return { status: "stale" };
        }
        offer = { kind: "fish", fish: details(offered) };
      } else {
        if (!Number.isFinite(insert.offer.amount) || insert.offer.amount <= 0) return { status: "stale" };
        offer = { kind: "money", amount: insert.offer.amount };
      }
      const trade: TradeRow = {
        id: nextTradeId++,
        chatId: insert.chatId,
        initiatorUserId: insert.initiatorUserId,
        initiatorFirstName: insert.initiatorFirstName,
        targetUserId: insert.targetUserId,
        targetFirstName: insert.targetFirstName,
        offer,
        requestedFish: details(requested),
        status: "pending",
      };
      trades.set(trade.id, trade);
      return { status: "created", trade };
    },
    async getTrade(id: number) {
      calls.push("getTrade");
      return trades.get(id) ?? null;
    },
    async declineTrade(id: number, targetUserId: number, chatId: number): Promise<DeclineTradeResult> {
      calls.push("declineTrade");
      const trade = trades.get(id);
      if (trade === undefined || trade.chatId !== chatId) return { status: "unavailable" };
      if (trade.targetUserId !== targetUserId) return { status: "not_target" };
      if (trade.status !== "pending") return { status: "unavailable" };
      trade.status = "declined";
      return { status: "declined" };
    },
    async acceptTrade(id: number, targetUserId: number, chatId: number): Promise<AcceptTradeResult> {
      calls.push("acceptTrade");
      const trade = trades.get(id);
      if (trade === undefined || trade.chatId !== chatId) return { status: "unavailable" };
      if (trade.targetUserId !== targetUserId) return { status: "not_target" };
      if (trade.status !== "pending") return { status: "unavailable" };
      const requested = fishes.get(trade.requestedFish!.id);
      if (requested === undefined || requested.state !== "available" || requested.userId !== trade.targetUserId) {
        trade.status = "unavailable";
        return { status: "unavailable" };
      }
      if (trade.offer.kind === "fish") {
        const offered = fishes.get(trade.offer.fish.id);
        if (offered === undefined || offered.state !== "available" || offered.userId !== trade.initiatorUserId) {
          trade.status = "unavailable";
          return { status: "unavailable" };
        }
        offered.userId = trade.targetUserId;
        offered.ownerName = trade.targetFirstName;
      } else {
        const initiator = fishers.get(fisherKey(trade.initiatorUserId, chatId));
        const target = fishers.get(fisherKey(trade.targetUserId, chatId));
        if (initiator === undefined || target === undefined || initiator.balance < trade.offer.amount) {
          trade.status = "unavailable";
          return { status: "unavailable" };
        }
        initiator.balance -= trade.offer.amount;
        target.balance += trade.offer.amount;
      }
      requested.userId = trade.initiatorUserId;
      requested.ownerName = trade.initiatorFirstName;
      trade.status = "accepted";
      return { status: "accepted" };
    },
  } as unknown as Repo;
  return { repo, calls, fishes, fishers, trades };
}
function seedFisher(fishers: Map<string, FakeFisher>, user: FixtureUser, chatId: number = GROUP_CHAT.id, balance = 0): void {
  fishers.set(`${user.id}:${chatId}`, { userId: user.id, chatId, firstName: user.first_name, balance });
}

function seedFish(
  fishes: Map<number, FakeFish>,
  id: number,
  user: FixtureUser,
  name: string,
  price: number,
  chatId: number = GROUP_CHAT.id,
): void {
  fishes.set(id, {
    id,
    userId: user.id,
    chatId,
    name,
    rarity: "Обычная",
    point: 1,
    weightG: 1000,
    sizeCm: 30,
    price,
    state: "available",
    ownerName: user.first_name,
  });
}

/**
 * Conversation contexts build their own Api client from the raw token, so the
 * custom fetch travels in the client options that propagate to them. It
 * records every outgoing call and answers ok without touching the network.
 */
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
  bot.use(conversations());
  registerTradeCommands(bot, repo);
  return { bot, apiCalls };
}

type InlineMarkup = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };

function sendCalls(apiCalls: ApiCall[]): ApiCall[] {
  return apiCalls.filter((call) => call.method === "sendMessage");
}

function answerCalls(apiCalls: ApiCall[]): ApiCall[] {
  return apiCalls.filter((call) => call.method === "answerCallbackQuery");
}

function editCalls(apiCalls: ApiCall[], method = "editEphemeralMessageText"): ApiCall[] {
  return apiCalls.filter((call) => call.method === method);
}

describe("/trade command", () => {
  test("a group reply to a player sends only an initiator-bound ephemeral builder", async () => {
    const { repo, calls, fishers } = createFakeRepo();
    seedFisher(fishers, TARGET);
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(commandUpdate({ updateId: 1, text: "/trade", replyTo: TARGET }));

    const sends = sendCalls(apiCalls);
    expect(sends).toHaveLength(1);
    expect(sends[0]!.payload.ephemeral_message_parameters).toEqual({ receiver_user_id: INITIATOR.id });
    expect(String(sends[0]!.payload.text)).toContain("Аня");
    const markup = sends[0]!.payload.reply_markup as InlineMarkup;
    expect(markup.inline_keyboard.map((row) => row.map((button) => button.text))).toEqual([
      ["Обменять рыбу"],
      ["Заплатить деньгами"],
    ]);
    expect(calls).not.toContain("createTrade");
    expect(apiCalls).toContainEqual({ method: "deleteMessage", payload: { chat_id: GROUP_CHAT.id, message_id: 1 } });
  });

  test("private, no-reply, bot-reply, and self-reply invocations do not create an offer", async () => {
    for (const spec of [
      { name: "private", update: commandUpdate({ updateId: 1, text: "/trade", chat: PRIVATE_CHAT }) },
      { name: "no reply", update: commandUpdate({ updateId: 2, text: "/trade" }) },
      {
        name: "bot reply",
        update: commandUpdate({ updateId: 3, text: "/trade", replyTo: { id: 5, first_name: "FishBot", is_bot: true } }),
      },
      { name: "self reply", update: commandUpdate({ updateId: 4, text: "/trade", replyTo: INITIATOR }) },
    ] as const) {
      const { repo, calls } = createFakeRepo();
      const { bot, apiCalls } = createTestBot(repo);

      await bot.handleUpdate(spec.update);

      const sends = sendCalls(apiCalls);
      if (spec.name === "private") {
        expect(sends).toHaveLength(0);
      } else {
        expect(sends).toHaveLength(1);
        expect(sends[0]!.payload.text).toBe(TRADE_USAGE);
        expect(sends[0]!.payload.ephemeral_message_parameters).toBeUndefined();
      }
      expect(calls).not.toContain("createTrade");
      expect(apiCalls).not.toContainEqual(expect.objectContaining({ method: "deleteMessage" }));
    }
  });
});

describe("fish-for-fish builder", () => {
  test("walks initiator and target inventories to one public notification", async () => {
    const { repo, calls, fishers, fishes } = createFakeRepo();
    seedFisher(fishers, TARGET);
    seedFish(fishes, 1, INITIATOR, "Окунь", 100);
    seedFish(fishes, 2, TARGET, "Щука", 200);
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(commandUpdate({ updateId: 1, text: "/trade", replyTo: TARGET }));
    await bot.handleUpdate(
      builderCallback({
        updateId: 2,
        ownerId: INITIATOR.id,
        targetId: TARGET.id,
        pressingId: INITIATOR.id,
        data: buildMenuCallbackData(INITIATOR.id, TARGET.id, { kind: "initiatorFish", page: 1 }),
      }),
    );
    await bot.handleUpdate(
      builderCallback({
        updateId: 3,
        ownerId: INITIATOR.id,
        targetId: TARGET.id,
        pressingId: INITIATOR.id,
        data: buildMenuCallbackData(INITIATOR.id, TARGET.id, { kind: "pickInitiatorFish", fishId: 1 }),
      }),
    );
    apiCalls.length = 0;
    await bot.handleUpdate(
      builderCallback({
        updateId: 4,
        ownerId: INITIATOR.id,
        targetId: TARGET.id,
        pressingId: INITIATOR.id,
        data: buildMenuCallbackData(INITIATOR.id, TARGET.id, { kind: "pickTargetFish", offeredFishId: 1, fishId: 2 }),
      }),
    );

    expect(calls.filter((name) => name === "createTrade")).toHaveLength(1);
    expect(editCalls(apiCalls)).toHaveLength(0);
    const sends = sendCalls(apiCalls);
    expect(sends).toHaveLength(1);
    const offer = sends[0]!;
    expect(offer.payload.ephemeral_message_parameters).toBeUndefined();
    const text = String(offer.payload.text);
    expect(text).toContain(`tg://user?id=${INITIATOR.id}`);
    expect(text).toContain(`tg://user?id=${TARGET.id}`);
    expect(text).toContain("Окунь");
    expect(text).toContain("Щука");
    expect(text).toContain("100 ₽");
    expect(text).toContain("200 ₽");
    const markup = offer.payload.reply_markup as InlineMarkup;
    expect(markup.inline_keyboard[0]!.map((button) => [button.text, button.callback_data])).toEqual([
      ["Принять", buildPublicCallbackData(1, { kind: "accept" })],
      ["Отклонить", buildPublicCallbackData(1, { kind: "decline" })],
    ]);
    expect(answerCalls(apiCalls)[0]!.payload.text).toBe("Предложение отправлено.");
  });

  test("shows an empty screen when the initiator has no available fish", async () => {
    const { repo, fishers, fishes } = createFakeRepo();
    seedFisher(fishers, TARGET);
    seedFish(fishes, 2, TARGET, "Щука", 200);
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(
      builderCallback({
        updateId: 1,
        ownerId: INITIATOR.id,
        targetId: TARGET.id,
        pressingId: INITIATOR.id,
        data: buildMenuCallbackData(INITIATOR.id, TARGET.id, { kind: "initiatorFish", page: 1 }),
      }),
    );

    const edits = editCalls(apiCalls);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.payload.text).toBe(INITIATOR_FISH_EMPTY);
    const markup = edits[0]!.payload.reply_markup as InlineMarkup;
    expect(markup.inline_keyboard.flat().map((button) => button.text)).toEqual(["Назад"]);
  });

  test("shows an empty screen when the target has no available fish", async () => {
    const { repo, calls, fishers, fishes } = createFakeRepo();
    seedFisher(fishers, TARGET);
    seedFish(fishes, 1, INITIATOR, "Окунь", 100);
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(
      builderCallback({
        updateId: 1,
        ownerId: INITIATOR.id,
        targetId: TARGET.id,
        pressingId: INITIATOR.id,
        data: buildMenuCallbackData(INITIATOR.id, TARGET.id, { kind: "pickInitiatorFish", fishId: 1 }),
      }),
    );

    const edits = editCalls(apiCalls);
    expect(edits).toHaveLength(1);
    expect(String(edits[0]!.payload.text)).toContain("нет доступной рыбы");
    const markup = edits[0]!.payload.reply_markup as InlineMarkup;
    expect(markup.inline_keyboard.flat().map((button) => button.text)).toEqual(["Назад"]);
    expect(calls).not.toContain("createTrade");
  });

  test("a non-owner cannot operate the builder and stale presses are answered", async () => {
    const { repo, calls, fishers, fishes } = createFakeRepo();
    seedFisher(fishers, TARGET);
    seedFish(fishes, 1, INITIATOR, "Окунь", 100);
    seedFish(fishes, 2, TARGET, "Щука", 200);
    const { bot, apiCalls } = createTestBot(repo);
    const data = buildMenuCallbackData(INITIATOR.id, TARGET.id, { kind: "pickTargetFish", offeredFishId: 1, fishId: 2 });

    await bot.handleUpdate(
      builderCallback({
        updateId: 1,
        ownerId: INITIATOR.id,
        targetId: TARGET.id,
        pressingId: FOREIGNER.id,
        data,
      }),
    );
    expect(answerCalls(apiCalls)[0]!.payload).toMatchObject({ text: FOREIGN_MENU_ALERT, show_alert: true });
    expect(editCalls(apiCalls)).toHaveLength(0);
    expect(sendCalls(apiCalls)).toHaveLength(0);
    expect(calls).not.toContain("createTrade");

    apiCalls.length = 0;
    await bot.handleUpdate(
      builderCallback({
        updateId: 2,
        ownerId: INITIATOR.id,
        targetId: TARGET.id,
        pressingId: INITIATOR.id,
        data,
        ephemeral: false,
      }),
    );
    expect(answerCalls(apiCalls)[0]!.payload).toMatchObject({ text: STALE_MENU_ALERT, show_alert: true });
    expect(editCalls(apiCalls)).toHaveLength(0);
    expect(sendCalls(apiCalls)).toHaveLength(0);
    expect(calls).not.toContain("createTrade");
  });
});

describe("money-for-fish builder", () => {
  test("prompts until a valid amount from the initiator and publishes one offer", async () => {
    const { repo, calls, fishers, fishes } = createFakeRepo();
    seedFisher(fishers, TARGET);
    seedFisher(fishers, INITIATOR, GROUP_CHAT.id, 50);
    seedFish(fishes, 2, TARGET, "Щука", 200);
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(
      builderCallback({
        updateId: 1,
        ownerId: INITIATOR.id,
        targetId: TARGET.id,
        pressingId: INITIATOR.id,
        data: buildMenuCallbackData(INITIATOR.id, TARGET.id, { kind: "targetFishMoney", page: 1 }),
      }),
    );
    const listing = editCalls(apiCalls)[0]!;
    expect(String(listing.payload.text)).toContain("Щука");

    await bot.handleUpdate(
      builderCallback({
        updateId: 2,
        ownerId: INITIATOR.id,
        targetId: TARGET.id,
        pressingId: INITIATOR.id,
        data: buildMenuCallbackData(INITIATOR.id, TARGET.id, { kind: "pickTargetFishMoney", fishId: 2 }),
      }),
    );
    const prompt = sendCalls(apiCalls).at(-1)!;
    expect(String(prompt.payload.text)).toContain("Введите сумму");
    // The whole amount dialog is visible only to the initiator.
    expect(prompt.payload.ephemeral_message_parameters).toEqual({ receiver_user_id: INITIATOR.id });
    expect(calls).not.toContain("createTrade");

    // Invalid input keeps prompting without creating an offer.
    await bot.handleUpdate(textUpdate({ updateId: 3, text: "abc", from: INITIATOR }));
    const invalid = sendCalls(apiCalls).at(-1)!;
    expect(invalid.payload.text).toBe(MONEY_INVALID);
    expect(invalid.payload.ephemeral_message_parameters).toEqual({ receiver_user_id: INITIATOR.id });
    await bot.handleUpdate(textUpdate({ updateId: 4, text: "1.234", from: INITIATOR }));
    expect(sendCalls(apiCalls).at(-1)!.payload.text).toBe(MONEY_INVALID);
    expect(calls).not.toContain("createTrade");

    // Other players' messages are passed through, not consumed by the prompt.
    apiCalls.length = 0;
    await bot.handleUpdate(textUpdate({ updateId: 5, text: "10,50", from: FOREIGNER }));
    expect(sendCalls(apiCalls)).toHaveLength(0);
    expect(calls).not.toContain("createTrade");

    await bot.handleUpdate(textUpdate({ updateId: 6, text: "10,50", from: INITIATOR }));

    expect(calls.filter((name) => name === "createTrade")).toHaveLength(1);
    const publicSends = sendCalls(apiCalls).filter((call) => call.payload.ephemeral_message_parameters === undefined);
    expect(publicSends).toHaveLength(1);
    const text = String(publicSends[0]!.payload.text);
    expect(text).toContain("10.5 ₽");
    expect(text).toContain("Щука");
    // Conversation Api calls bypass the bot-level transformer; HTML must be explicit.
    expect(publicSends[0]!.payload.parse_mode).toBe("HTML");
    const markup = publicSends[0]!.payload.reply_markup as InlineMarkup;
    expect(markup.inline_keyboard[0]!.map((button) => button.text)).toEqual(["Принять", "Отклонить"]);
  });

  test("shows an empty screen when the target has no fish for a money offer", async () => {
    const { repo, calls, fishers } = createFakeRepo();
    seedFisher(fishers, TARGET);
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(
      builderCallback({
        updateId: 1,
        ownerId: INITIATOR.id,
        targetId: TARGET.id,
        pressingId: INITIATOR.id,
        data: buildMenuCallbackData(INITIATOR.id, TARGET.id, { kind: "targetFishMoney", page: 1 }),
      }),
    );

    const edits = editCalls(apiCalls);
    expect(edits).toHaveLength(1);
    expect(String(edits[0]!.payload.text)).toContain("нет доступной рыбы");
    const markup = edits[0]!.payload.reply_markup as InlineMarkup;
    expect(markup.inline_keyboard.flat().map((button) => button.text)).toEqual(["Назад"]);
    expect(calls).not.toContain("createTrade");
  });
});


type PendingOfferFixture = {
  bot: Bot<BotContext>;
  apiCalls: ApiCall[];
  calls: string[];
  fishes: Map<number, FakeFish>;
  fishers: Map<string, FakeFisher>;
  trades: Map<number, TradeRow>;
};
describe("public offer resolution", () => {
  async function createPendingOffer(): Promise<PendingOfferFixture> {
    const { repo, calls, fishers, fishes, trades } = createFakeRepo();
    seedFisher(fishers, TARGET);
    seedFisher(fishers, INITIATOR);
    seedFish(fishes, 1, INITIATOR, "Окунь", 100);
    seedFish(fishes, 2, TARGET, "Щука", 200);
    const { bot, apiCalls } = createTestBot(repo);
    await bot.handleUpdate(
      builderCallback({
        updateId: 1,
        ownerId: INITIATOR.id,
        targetId: TARGET.id,
        pressingId: INITIATOR.id,
        data: buildMenuCallbackData(INITIATOR.id, TARGET.id, { kind: "pickTargetFish", offeredFishId: 1, fishId: 2 }),
      }),
    );
    apiCalls.length = 0;
    calls.length = 0;
    return { bot, apiCalls, calls, fishes, fishers, trades };
  }

  test("the target accepts, swaps ownership once, and a replay cannot mutate again", async () => {
    const { bot, apiCalls, calls, fishes } = await createPendingOffer();

    await bot.handleUpdate(
      publicCallback({
        updateId: 2,
        pressingId: TARGET.id,
        data: buildPublicCallbackData(1, { kind: "accept" }),
      }),
    );

    expect(calls).toEqual(["getTrade", "acceptTrade"]);
    const edits = editCalls(apiCalls, "editMessageText");
    expect(edits).toHaveLength(1);
    expect(edits[0]!.payload.text).toBe("🤝 Обмен завершён");
    expect(fishes.get(1)).toMatchObject({ userId: TARGET.id, ownerName: TARGET.first_name });
    expect(fishes.get(2)).toMatchObject({ userId: INITIATOR.id, ownerName: INITIATOR.first_name });

    apiCalls.length = 0;
    calls.length = 0;
    await bot.handleUpdate(
      publicCallback({
        updateId: 3,
        pressingId: TARGET.id,
        data: buildPublicCallbackData(1, { kind: "accept" }),
      }),
    );
    expect(calls).toEqual(["getTrade"]);
    expect(editCalls(apiCalls, "editMessageText")).toHaveLength(0);
    expect(answerCalls(apiCalls)[0]!.payload.text).toBe("🤝 Обмен завершён");
    expect(fishes.get(1)).toMatchObject({ userId: TARGET.id });
    expect(fishes.get(2)).toMatchObject({ userId: INITIATOR.id });
  });

  test("a non-target press answers an alert and never mutates", async () => {
    const { bot, apiCalls, calls, fishes, trades } = await createPendingOffer();

    await bot.handleUpdate(
      publicCallback({
        updateId: 2,
        pressingId: FOREIGNER.id,
        data: buildPublicCallbackData(1, { kind: "accept" }),
      }),
    );

    expect(calls).toEqual(["getTrade"]);
    expect(answerCalls(apiCalls)[0]!.payload).toMatchObject({ text: FOREIGN_TRADE_ALERT, show_alert: true });
    expect(editCalls(apiCalls, "editMessageText")).toHaveLength(0);
    expect(trades.get(1)!.status).toBe("pending");
    expect(fishes.get(1)).toMatchObject({ userId: INITIATOR.id });
    expect(fishes.get(2)).toMatchObject({ userId: TARGET.id });
  });

  test("a copied public message in another chat cannot mutate trade state", async () => {
    const { bot, apiCalls, calls, trades } = await createPendingOffer();

    await bot.handleUpdate(
      publicCallback({
        updateId: 2,
        pressingId: TARGET.id,
        data: buildPublicCallbackData(1, { kind: "decline" }),
        chatId: SECOND_CHAT.id,
      }),
    );

    expect(calls).toEqual(["getTrade"]);
    expect(answerCalls(apiCalls)[0]!.payload).toMatchObject({ text: FOREIGN_TRADE_ALERT, show_alert: true });
    expect(editCalls(apiCalls, "editMessageText")).toHaveLength(0);
    expect(trades.get(1)!.status).toBe("pending");
  });

  test("decline leaves both inventories untouched", async () => {
    const { bot, apiCalls, calls, fishes, trades } = await createPendingOffer();

    await bot.handleUpdate(
      publicCallback({
        updateId: 2,
        pressingId: TARGET.id,
        data: buildPublicCallbackData(1, { kind: "decline" }),
      }),
    );

    expect(calls).toEqual(["getTrade", "declineTrade"]);
    const edits = editCalls(apiCalls, "editMessageText");
    expect(edits).toHaveLength(1);
    expect(edits[0]!.payload.text).toBe("🤝 Обмен отклонён");
    expect(trades.get(1)!.status).toBe("declined");
    expect(fishes.get(1)).toMatchObject({ userId: INITIATOR.id });
    expect(fishes.get(2)).toMatchObject({ userId: TARGET.id });
  });
});

describe("parseMoneyAmount", () => {
  test("accepts finite positive decimals with at most two fractional digits", () => {
    expect(parseMoneyAmount("10")).toBe(10);
    expect(parseMoneyAmount("10,50")).toBe(10.5);
    expect(parseMoneyAmount(" 7 ")).toBe(7);
    expect(parseMoneyAmount("0.01")).toBe(0.01);
  });

  test("rejects zero, negatives, junk, and extra precision", () => {
    for (const text of ["0", "-5", "abc", "", "1.234", "12.", ".5", "1e3", "0,00", "10 kg"]) {
      expect(parseMoneyAmount(text)).toBeNull();
    }
  });
});
