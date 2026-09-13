import { describe, expect, test, spyOn } from "bun:test";
import { Bot } from "grammy";
import type { Chat, Update, User } from "grammy/types";
import type { BotContext } from "../../bot.ts";
import type { InventoryFishRow, InventoryPage, Repo, UpgradeFishInput, UpgradeFishResult, UpgradeFishSource } from "../../db/index.ts";
import { setCatalog } from "../fishing/catalog.ts";
import { buildFishUpgradeCallbackData } from "./callback-data.ts";
import { registerFishUpgradeCommands } from "./commands.ts";
import { FISH_UPGRADE_EMPTY, FISH_UPGRADE_FOREIGN, FISH_UPGRADE_STALE } from "./messages.ts";

type CommandChat = Extract<Chat, { type: "group" | "supergroup" | "private" }>;
type FixtureUser = { id: number; first_name: string; is_bot?: boolean };
type ApiCall = { method: string; payload: Record<string, unknown> };

const INITIATOR: FixtureUser = { id: 9, first_name: "Иван" };
const FOREIGNER: FixtureUser = { id: 33, first_name: "Чужак" };
const BOT_USER = { id: 999, is_bot: true, first_name: "FishBot" };
const GROUP_CHAT: CommandChat = { id: -100, type: "supergroup", title: "Рыбаки" };
const PRIVATE_CHAT: CommandChat = { id: 7, type: "private", first_name: "Иван" };

const FOREIGN_MENU_ALERT = "Это меню принадлежит другому игроку.";
const STALE_MENU_ALERT = "Кнопка устарела. Откройте /fish_upgrade заново.";

/** Catalog with rarity points 1 and 2 only, so point 2 has no next group. */
const TEST_CATALOG = [
  [{ name: "Карась", rarity: "Обычная", point: 1 }],
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
        text: "🎣 Улучшение рыбы",
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
};

function createFakeRepo(): FakeRepoState {
  const calls: string[] = [];
  const fishes = new Map<number, FakeFish>();
  const fishers = new Map<string, FakeFisher>();
  let nextFishId = 100;
  const fisherKey = (userId: number, chatId: number) => `${userId}:${chatId}`;

  const repo = {
    async ensureFisher(userId: number, chatId: number, firstName: string) {
      calls.push("ensureFisher");
      if (!fishers.has(fisherKey(userId, chatId))) {
        fishers.set(fisherKey(userId, chatId), { userId, chatId, firstName, balance: 0 });
      }
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
          .map(({ id, name, rarity, point, sizeCm, weightG, price }) => ({
            id,
            name,
            rarity,
            point,
            sizeCm,
            weightG,
            price,
            fishModifierId: null,
            fishModifierName: null,
            fishModifierRarity: null,
          })),
        page: currentPage,
        totalCount,
        totalValue,
      };
    },
    async getAvailableCatch(userId: number, chatId: number, fishId: number): Promise<InventoryFishRow | null> {
      calls.push("getAvailableCatch");
      const fish = fishes.get(fishId);
      if (fish === undefined || fish.userId !== userId || fish.chatId !== chatId || fish.state !== "available") return null;
      const { id, name, rarity, point, sizeCm, weightG, price } = fish;
      return {
        id,
        name,
        rarity,
        point,
        sizeCm,
        weightG,
        price,
        fishModifierId: null,
        fishModifierName: null,
        fishModifierRarity: null,
      };
    },
    async upgradeFish(input: UpgradeFishInput): Promise<UpgradeFishResult> {
      calls.push("upgradeFish");
      const fish = fishes.get(input.fishId);
      if (fish === undefined || fish.userId !== input.userId || fish.chatId !== input.chatId || fish.state !== "available") {
        return { status: "not_available" };
      }
      const source: UpgradeFishSource = { id: fish.id, name: fish.name, rarity: fish.rarity, point: fish.point };
      const chance = input.chanceForPoint(fish.point);
      if (chance === null) return { status: "max_rarity", source };
      const targetPoint = fish.point + 1;
      if ((input.catalog[targetPoint - 1]?.length ?? 0) === 0) return { status: "target_rarity_missing", source };
      fish.state = "spent";
      if (!input.roll(chance)) return { status: "failed", chance, source };
      const created = input.buildCatch(targetPoint);
      const id = nextFishId++;
      fishes.set(id, {
        id,
        userId: input.userId,
        chatId: input.chatId,
        name: created.name,
        rarity: created.rarity,
        point: created.point,
        weightG: created.weightG,
        sizeCm: created.sizeCm,
        price: created.price,
        state: "available",
        ownerName: input.firstName,
      });
      return { status: "upgraded", chance, source, created };
    },
  } as unknown as Repo;
  return { repo, calls, fishes, fishers };
}

function seedFisher(fishers: Map<string, FakeFisher>, user: FixtureUser, chatId: number = GROUP_CHAT.id): void {
  fishers.set(`${user.id}:${chatId}`, { userId: user.id, chatId, firstName: user.first_name, balance: 0 });
}

function seedFish(
  fishes: Map<number, FakeFish>,
  id: number,
  user: FixtureUser,
  overrides: Partial<Pick<FakeFish, "point" | "rarity" | "state">> = {},
): void {
  fishes.set(id, {
    id,
    userId: user.id,
    chatId: GROUP_CHAT.id,
    name: `Рыба ${id}`,
    rarity: overrides.rarity ?? "Обычная",
    point: overrides.point ?? 1,
    weightG: 1000,
    sizeCm: 30,
    price: 100 * id,
    state: overrides.state ?? "available",
    ownerName: user.first_name,
  });
}

/**
 * The command rolls via Math.random (through didUpgradeSucceed); the first
 * stubbed value decides success, later draws feed the catch generator from a
 * deterministic LCG so beta/gamma sampling still terminates.
 */
function stubRandom(firstValue: number) {
  let seed = 42;
  const lcg = () => {
    seed = (seed * 1103515245 + 12345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const queue = [firstValue];
  return spyOn(Math, "random").mockImplementation(() => queue.shift() ?? lcg());
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
  registerFishUpgradeCommands(bot, repo);
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

function availableFish(fishes: Map<number, FakeFish>): FakeFish[] {
  return [...fishes.values()].filter((fish) => fish.state === "available");
}

describe("/fish_upgrade command", () => {
  test("a group invocation opens an owner-bound ephemeral menu and deletes the command", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, calls, fishers, fishes } = createFakeRepo();
    seedFisher(fishers, INITIATOR);
    seedFish(fishes, 1, INITIATOR);
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(commandUpdate({ updateId: 1, text: "/fish_upgrade" }));

    const sends = sendCalls(apiCalls);
    expect(sends).toHaveLength(1);
    expect(sends[0]!.payload.ephemeral_message_parameters).toEqual({ receiver_user_id: INITIATOR.id });
    const text = String(sends[0]!.payload.text);
    expect(text).toContain("Улучшение рыбы");
    expect(text).toContain("1→2: 80%");
    const markup = sends[0]!.payload.reply_markup as InlineMarkup;
    expect(markup.inline_keyboard.map((row) => row.map((button) => button.text))).toEqual([["#1 Рыба 1 · Обычная"]]);
    expect(markup.inline_keyboard[0]![0]!.callback_data).toBe(
      buildFishUpgradeCallbackData(INITIATOR.id, { kind: "confirm", fishId: 1 }),
    );
    expect(calls).toContain("ensureFisher");
    expect(calls).not.toContain("upgradeFish");
    expect(apiCalls).toContainEqual({ method: "deleteMessage", payload: { chat_id: GROUP_CHAT.id, message_id: 1 } });
  });

  test("private invocations are ignored entirely", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, calls } = createFakeRepo();
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(commandUpdate({ updateId: 1, text: "/fish_upgrade", chat: PRIVATE_CHAT }));

    expect(sendCalls(apiCalls)).toHaveLength(0);
    expect(calls).not.toContain("ensureFisher");
    expect(apiCalls).not.toContainEqual(expect.objectContaining({ method: "deleteMessage" }));
  });

  test("an empty inventory shows the empty screen", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, fishers } = createFakeRepo();
    seedFisher(fishers, INITIATOR);
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(commandUpdate({ updateId: 1, text: "/fish_upgrade" }));

    const sends = sendCalls(apiCalls);
    expect(sends).toHaveLength(1);
    expect(sends[0]!.payload.text).toBe(FISH_UPGRADE_EMPTY);
    expect(sends[0]!.payload.reply_markup).toBeUndefined();
  });

  test("lists only own available fish and paginates five per page", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, fishers, fishes } = createFakeRepo();
    seedFisher(fishers, INITIATOR);
    for (const id of [1, 2, 3, 4, 5, 6]) seedFish(fishes, id, INITIATOR);
    seedFish(fishes, 7, FOREIGNER);
    seedFish(fishes, 8, INITIATOR, { state: "sold" });
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(commandUpdate({ updateId: 1, text: "/fish_upgrade" }));
    const pageOne = ((sendCalls(apiCalls)[0]!.payload.reply_markup as InlineMarkup).inline_keyboard.map((row) =>
      row.map((button) => button.text),
    ));
    expect(pageOne).toEqual([
      ["#6 Рыба 6 · Обычная"],
      ["#5 Рыба 5 · Обычная"],
      ["#4 Рыба 4 · Обычная"],
      ["#3 Рыба 3 · Обычная"],
      ["#2 Рыба 2 · Обычная"],
      ["→"],
    ]);

    await bot.handleUpdate(
      menuCallback({
        updateId: 2,
        ownerId: INITIATOR.id,
        pressingId: INITIATOR.id,
        data: buildFishUpgradeCallbackData(INITIATOR.id, { kind: "list", page: 2 }),
      }),
    );

    const edits = editCalls(apiCalls);
    expect(edits).toHaveLength(1);
    const markup = edits[0]!.payload.reply_markup as InlineMarkup;
    expect(markup.inline_keyboard.map((row) => row.map((button) => button.text))).toEqual([["#1 Рыба 1 · Обычная"], ["←"]]);
    const allTexts = pageOne.flat().join(" ");
    expect(allTexts).not.toContain("#7");
    expect(allTexts).not.toContain("#8");
  });
});

describe("confirmation screen", () => {
  test("a fish button shows the exact chance and asks for confirmation before upgrading", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, calls, fishers, fishes } = createFakeRepo();
    seedFisher(fishers, INITIATOR);
    seedFish(fishes, 1, INITIATOR);
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(
      menuCallback({
        updateId: 1,
        ownerId: INITIATOR.id,
        pressingId: INITIATOR.id,
        data: buildFishUpgradeCallbackData(INITIATOR.id, { kind: "confirm", fishId: 1 }),
      }),
    );

    expect(calls).toContain("getAvailableCatch");
    expect(calls).not.toContain("upgradeFish");
    expect(fishes.get(1)!.state).toBe("available");
    const edits = editCalls(apiCalls);
    expect(edits).toHaveLength(1);
    const text = String(edits[0]!.payload.text);
    expect(text).toContain("Подтверждение улучшения");
    expect(text).toContain("#1 <b>Рыба 1</b> (Обычная)");
    expect(text).toContain("Цель: Редкая (редкость 2)");
    expect(text).toContain("Шанс успеха: 80%");
    const markup = edits[0]!.payload.reply_markup as InlineMarkup;
    expect(markup.inline_keyboard.map((row) => row.map((button) => button.text))).toEqual([
      ["🎣 Улучшить"],
      ["← К списку"],
    ]);
    expect(markup.inline_keyboard[0]![0]!.callback_data).toBe(
      buildFishUpgradeCallbackData(INITIATOR.id, { kind: "apply", fishId: 1 }),
    );
    expect(answerCalls(apiCalls)).toHaveLength(1);
  });

  test("confirmation for a max-rarity fish explains and offers no apply button", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, calls, fishers, fishes } = createFakeRepo();
    seedFisher(fishers, INITIATOR);
    seedFish(fishes, 5, INITIATOR, { point: 6, rarity: "Легендарная" });
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(
      menuCallback({
        updateId: 1,
        ownerId: INITIATOR.id,
        pressingId: INITIATOR.id,
        data: buildFishUpgradeCallbackData(INITIATOR.id, { kind: "confirm", fishId: 5 }),
      }),
    );

    expect(calls).not.toContain("upgradeFish");
    const edits = editCalls(apiCalls);
    expect(edits).toHaveLength(1);
    expect(String(edits[0]!.payload.text)).toContain("максимальной доступной редкости");
    const markup = edits[0]!.payload.reply_markup as InlineMarkup;
    expect(markup.inline_keyboard.flat().map((button) => [button.text, button.callback_data])).toEqual([
      ["← К списку", buildFishUpgradeCallbackData(INITIATOR.id, { kind: "list", page: 1 })],
    ]);
    expect(fishes.get(5)!.state).toBe("available");
  });

  test("confirmation for a fish with no next rarity group explains and offers no apply button", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, fishers, fishes } = createFakeRepo();
    seedFisher(fishers, INITIATOR);
    seedFish(fishes, 3, INITIATOR, { point: 2, rarity: "Редкая" });
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(
      menuCallback({
        updateId: 1,
        ownerId: INITIATOR.id,
        pressingId: INITIATOR.id,
        data: buildFishUpgradeCallbackData(INITIATOR.id, { kind: "confirm", fishId: 3 }),
      }),
    );

    const edits = editCalls(apiCalls);
    expect(edits).toHaveLength(1);
    expect(String(edits[0]!.payload.text)).toContain("нет рыб следующей редкости");
    expect(edits[0]!.payload.reply_markup as InlineMarkup).toBeDefined();
    expect((edits[0]!.payload.reply_markup as InlineMarkup).inline_keyboard.flat().map((button) => button.text)).toEqual([
      "← К списку",
    ]);
    expect(fishes.get(3)!.state).toBe("available");
  });

  test("confirmation for an already unavailable fish shows the stale screen", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, fishers, fishes } = createFakeRepo();
    seedFisher(fishers, INITIATOR);
    seedFish(fishes, 1, INITIATOR, { state: "sold" });
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(
      menuCallback({
        updateId: 1,
        ownerId: INITIATOR.id,
        pressingId: INITIATOR.id,
        data: buildFishUpgradeCallbackData(INITIATOR.id, { kind: "confirm", fishId: 1 }),
      }),
    );

    const edits = editCalls(apiCalls);
    expect(edits).toHaveLength(1);
    expect(String(edits[0]!.payload.text)).toContain("больше недоступна");
    expect(fishes.get(1)!.state).toBe("sold");
  });
});

describe("fish upgrade attempts", () => {
  test("a foreign press alerts and never touches the inventory", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, calls, fishers, fishes } = createFakeRepo();
    seedFisher(fishers, INITIATOR);
    seedFish(fishes, 1, INITIATOR);
    const { bot, apiCalls } = createTestBot(repo);
    const data = buildFishUpgradeCallbackData(INITIATOR.id, { kind: "apply", fishId: 1 });

    await bot.handleUpdate(menuCallback({ updateId: 1, ownerId: INITIATOR.id, pressingId: FOREIGNER.id, data }));

    expect(answerCalls(apiCalls)[0]!.payload).toMatchObject({ text: FOREIGN_MENU_ALERT, show_alert: true });
    expect(editCalls(apiCalls)).toHaveLength(0);
    expect(calls).not.toContain("upgradeFish");
    expect(fishes.get(1)!.state).toBe("available");
  });

  test("a malformed callback is answered as stale and mutates nothing", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, calls } = createFakeRepo();
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(
      menuCallback({
        updateId: 1,
        ownerId: INITIATOR.id,
        pressingId: INITIATOR.id,
        data: "fup:1:x:1",
      }),
    );

    expect(answerCalls(apiCalls)[0]!.payload).toMatchObject({ text: STALE_MENU_ALERT, show_alert: true });
    expect(editCalls(apiCalls)).toHaveLength(0);
    expect(calls).not.toContain("upgradeFish");
  });

  test("a callback from a public menu is rejected as stale", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, calls, fishers, fishes } = createFakeRepo();
    seedFisher(fishers, INITIATOR);
    seedFish(fishes, 1, INITIATOR);
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(
      menuCallback({
        updateId: 1,
        ownerId: INITIATOR.id,
        pressingId: INITIATOR.id,
        data: buildFishUpgradeCallbackData(INITIATOR.id, { kind: "confirm", fishId: 1 }),
        ephemeral: false,
      }),
    );

    expect(answerCalls(apiCalls)[0]!.payload).toMatchObject({ text: STALE_MENU_ALERT, show_alert: true });
    expect(editCalls(apiCalls)).toHaveLength(0);
    expect(calls).not.toContain("getAvailableCatch");
  });

  test("success spends the source and adds exactly one point+1 fish", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, calls, fishers, fishes } = createFakeRepo();
    seedFisher(fishers, INITIATOR);
    seedFish(fishes, 1, INITIATOR);
    const { bot, apiCalls } = createTestBot(repo);
    const restoreRandom = stubRandom(0.1);

    try {
      await bot.handleUpdate(
        menuCallback({
          updateId: 1,
          ownerId: INITIATOR.id,
          pressingId: INITIATOR.id,
          data: buildFishUpgradeCallbackData(INITIATOR.id, { kind: "apply", fishId: 1 }),
        }),
      );
    } finally {
      restoreRandom.mockRestore();
    }

    expect(calls).toContain("upgradeFish");
    expect(fishes.get(1)!.state).toBe("spent");
    const created = availableFish(fishes);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ userId: INITIATOR.id, chatId: GROUP_CHAT.id, name: "Щука", point: 2, state: "available" });
    expect(editCalls(apiCalls)).toHaveLength(0);
    const sends = sendCalls(apiCalls);
    expect(sends).toHaveLength(1);
    const text = String(sends[0]!.payload.text);
    expect(text).toContain("Улучшение удалось");
    expect(text).toContain("#1");
    expect(text).toContain("Щука");
    expect(sends[0]!.payload.reply_markup).toBeUndefined();
    expect(text).toContain(`<a href="tg://user?id=${INITIATOR.id}">Иван</a>`);
    expect(answerCalls(apiCalls)[0]!.payload).toMatchObject({ text: "⬆️ Улучшение удалось!", show_alert: false });
  });

  test("failure consumes the source fish and creates nothing", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, calls, fishers, fishes } = createFakeRepo();
    seedFisher(fishers, INITIATOR);
    seedFish(fishes, 1, INITIATOR);
    const { bot, apiCalls } = createTestBot(repo);
    const restoreRandom = stubRandom(0.9);

    try {
      await bot.handleUpdate(
        menuCallback({
          updateId: 1,
          ownerId: INITIATOR.id,
          pressingId: INITIATOR.id,
          data: buildFishUpgradeCallbackData(INITIATOR.id, { kind: "apply", fishId: 1 }),
        }),
      );
    } finally {
      restoreRandom.mockRestore();
    }

    expect(calls).toContain("upgradeFish");
    expect(fishes.get(1)!.state).toBe("spent");
    expect(availableFish(fishes)).toHaveLength(0);
    expect(editCalls(apiCalls)).toHaveLength(0);
    expect(sendCalls(apiCalls)).toHaveLength(1);
    expect(String(sendCalls(apiCalls)[0]!.payload.text)).toContain(`<a href="tg://user?id=${INITIATOR.id}">Иван</a>`);
    expect(String(sendCalls(apiCalls)[0]!.payload.text)).toContain("Улучшение не удалось");
    expect(answerCalls(apiCalls)[0]!.payload).toMatchObject({ text: "Попытка не удалась.", show_alert: false });
  });

  test("a direct apply press on a max-rarity fish is rejected with a reason and stays intact", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, calls, fishers, fishes } = createFakeRepo();
    seedFisher(fishers, INITIATOR);
    seedFish(fishes, 5, INITIATOR, { point: 6, rarity: "Легендарная" });
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(
      menuCallback({
        updateId: 1,
        ownerId: INITIATOR.id,
        pressingId: INITIATOR.id,
        data: buildFishUpgradeCallbackData(INITIATOR.id, { kind: "apply", fishId: 5 }),
      }),
    );

    const edits = editCalls(apiCalls);
    expect(edits).toHaveLength(1);
    expect(String(edits[0]!.payload.text)).toContain("максимальной доступной редкости");
    const markup = edits[0]!.payload.reply_markup as InlineMarkup;
    expect(markup.inline_keyboard.flat().map((button) => [button.text, button.callback_data])).toEqual([
      ["← К списку", buildFishUpgradeCallbackData(INITIATOR.id, { kind: "list", page: 1 })],
    ]);
    expect(answerCalls(apiCalls)[0]!.payload).toMatchObject({ text: "Эта рыба уже максимальной редкости.", show_alert: true });
    expect(fishes.get(5)!.state).toBe("available");
  });

  test("a direct apply press on a fish whose next rarity group is missing is rejected", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, calls, fishers, fishes } = createFakeRepo();
    seedFisher(fishers, INITIATOR);
    seedFish(fishes, 3, INITIATOR, { point: 2, rarity: "Редкая" });
    const { bot, apiCalls } = createTestBot(repo);

    await bot.handleUpdate(
      menuCallback({
        updateId: 1,
        ownerId: INITIATOR.id,
        pressingId: INITIATOR.id,
        data: buildFishUpgradeCallbackData(INITIATOR.id, { kind: "apply", fishId: 3 }),
      }),
    );

    const edits = editCalls(apiCalls);
    expect(edits).toHaveLength(1);
    expect(String(edits[0]!.payload.text)).toContain("нет рыб следующей редкости");
    expect((edits[0]!.payload.reply_markup as InlineMarkup).inline_keyboard.flat().map((button) => button.text)).toEqual([
      "← К списку",
    ]);
    expect(calls.filter((name) => name === "upgradeFish")).toHaveLength(1);
    expect(fishes.get(3)!.state).toBe("available");
  });

  test("a replayed press on an already-upgraded fish answers as unavailable", async () => {
    setCatalog(TEST_CATALOG);
    const { repo, calls, fishers, fishes } = createFakeRepo();
    seedFisher(fishers, INITIATOR);
    seedFish(fishes, 1, INITIATOR);
    const { bot, apiCalls } = createTestBot(repo);
    const data = buildFishUpgradeCallbackData(INITIATOR.id, { kind: "apply", fishId: 1 });
    const restoreRandom = stubRandom(0.1);

    try {
      await bot.handleUpdate(menuCallback({ updateId: 1, ownerId: INITIATOR.id, pressingId: INITIATOR.id, data }));
    } finally {
      restoreRandom.mockRestore();
    }
    apiCalls.length = 0;
    calls.length = 0;

    await bot.handleUpdate(menuCallback({ updateId: 2, ownerId: INITIATOR.id, pressingId: INITIATOR.id, data }));

    expect(calls).toEqual(["upgradeFish"]);
    const edits = editCalls(apiCalls);
    expect(edits).toHaveLength(1);
    expect(String(edits[0]!.payload.text)).toContain("больше недоступна");
    expect((edits[0]!.payload.reply_markup as InlineMarkup).inline_keyboard.flat().map((button) => button.text)).toEqual([
      "← К списку",
    ]);
    expect(answerCalls(apiCalls)[0]!.payload).toMatchObject({ text: "Эта рыба уже недоступна.", show_alert: true });
    expect(availableFish(fishes).map((fish) => fish.point)).toEqual([2]);
  });
});
