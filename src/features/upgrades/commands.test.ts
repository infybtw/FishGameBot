import { expect, test } from "bun:test";
import { Bot } from "grammy";
import type { Config } from "../../config.ts";
import type { Repo } from "../../db/index.ts";
import { buildCallbackData } from "./callback-data.ts";
import { registerUpgradeCommands } from "./commands.ts";

type ApiCall = { method: string; payload: Record<string, unknown> };

const cfg: Config = {
  botToken: "123:test",
  adminUserId: 1,
  catchSuccessChance: 50,
  catchDelaySeconds: 0,
  curseDropChance: 0,
  fishModifierDropChance: 0,
  eventTimeZone: "Europe/Moscow",
  databaseUrl: "postgres://example/fishbot_test",
};

function createRepoFake() {
  const calls: string[] = [];
  const repo = {
    ensureFisher: async () => {
      calls.push("ensureFisher");
    },
    getFisher: async () => {
      calls.push("getFisher");
      return { userId: 11, chatId: -100, firstName: "Owner", balance: 0 };
    },
    getInventoryPage: async () => {
      calls.push("getInventoryPage");
      return { fishes: [], page: 1, totalCount: 0, totalValue: 0 };
    },
    getEquippedRodId: async () => {
      calls.push("getEquippedRodId");
      return "basic";
    },
    getRarityInventory: async () => {
      calls.push("getRarityInventory");
      return [];
    },
    listPurchasedRodIds: async () => {
      calls.push("listPurchasedRodIds");
      return [];
    },
    sellFish: async () => {
      calls.push("sellFish");
      return { status: "not_available" as const };
    },
    sellRarity: async () => ({ status: "not_available" as const }),
    getRaritySalePreview: async () => null,
    purchaseRod: async () => ({ status: "already_owned" as const }),
    equipRod: async () => ({ status: "not_owned" as const }),
    multiplyBalance: async () => {
      throw new Error("Unexpected repo call in test: multiplyBalance");
    },
  } as unknown as Repo;
  return { repo, calls };
}

function createBot(repo: Repo, calls: ApiCall[]): Bot {
  const bot = new Bot(cfg.botToken, {
    botInfo: { id: 999, is_bot: true, first_name: "FishBot", username: "fishbot" } as never,
  });
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: true } as never;
  });
  registerUpgradeCommands(bot as never, cfg, repo);
  return bot;
}

function callbackUpdate(ownerId: number, pressingUserId: number, data: string, ephemeral = true): Record<string, unknown> {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    callback_query: {
      id: `query-${pressingUserId}`,
      from: { id: pressingUserId, is_bot: false, first_name: "Player" },
      chat_instance: "instance",
      data,
      message: {
        message_id: 10,
        date: 1,
        chat: { id: -100, type: "supergroup", title: "Test" },
        from: { id: 999, is_bot: true, first_name: "FishBot" },
        text: `owner=${ownerId}`,
        ...(ephemeral
          ? {
              receiver_user: { id: ownerId, is_bot: false, first_name: "Owner" },
              ephemeral_message_id: 20,
            }
          : {}),
      },
    },
  };
}

test("owner callback reads and edits while a foreign callback is inert", async () => {
  const { repo, calls: repoCalls } = createRepoFake();
  const apiCalls: ApiCall[] = [];
  const bot = createBot(repo, apiCalls);
  const ownerId = 11;
  const data = buildCallbackData(ownerId, { kind: "fish", page: 1 });

  await bot.handleUpdate(callbackUpdate(ownerId, ownerId, data) as never);
  expect(repoCalls).toEqual(["getInventoryPage"]);
  expect(apiCalls.filter((call) => call.method === "editEphemeralMessageText")).toHaveLength(1);
  expect(apiCalls.filter((call) => call.method === "answerCallbackQuery")).toHaveLength(1);

  repoCalls.length = 0;
  apiCalls.length = 0;
  await bot.handleUpdate(callbackUpdate(ownerId, 22, data) as never);
  expect(repoCalls).toEqual([]);
  expect(apiCalls).toEqual([
    expect.objectContaining({ method: "answerCallbackQuery", payload: expect.objectContaining({ show_alert: true, text: "Это меню принадлежит другому игроку." }) }),
  ]);
});

test("stale sale redraws a clamped page and answers exactly once", async () => {
  const { repo, calls: repoCalls } = createRepoFake();
  const apiCalls: ApiCall[] = [];
  const bot = createBot(repo, apiCalls);
  await bot.handleUpdate(callbackUpdate(11, 11, buildCallbackData(11, { kind: "sell", fishId: 7 })) as never);

  expect(repoCalls).toEqual(["sellFish", "getInventoryPage"]);
  expect(apiCalls.filter((call) => call.method === "editEphemeralMessageText")).toHaveLength(1);
  expect(apiCalls.filter((call) => call.method === "answerCallbackQuery")).toHaveLength(1);
  expect(apiCalls.find((call) => call.method === "answerCallbackQuery")?.payload.text).toBe("Рыба уже недоступна.");
});

test("malformed and unavailable rarity callbacks are stale and do not mutate", async () => {
  const { repo, calls: repoCalls } = createRepoFake();
  const apiCalls: ApiCall[] = [];
  const bot = createBot(repo, apiCalls);
  await bot.handleUpdate(callbackUpdate(11, 11, "upg:11:rod:unknown") as never);
  expect(repoCalls).toEqual([]);
  expect(apiCalls.filter((call) => call.method === "answerCallbackQuery")).toHaveLength(1);
  expect(apiCalls.filter((call) => call.method === "editEphemeralMessageText")).toHaveLength(0);
});

test("rejects a replayed callback from a non-ephemeral message", async () => {
  const { repo, calls: repoCalls } = createRepoFake();
  const apiCalls: ApiCall[] = [];
  const bot = createBot(repo, apiCalls);
  await bot.handleUpdate(callbackUpdate(11, 11, buildCallbackData(11, { kind: "home" }), false) as never);

  expect(repoCalls).toEqual([]);
  expect(apiCalls.filter((call) => call.method === "editEphemeralMessageText")).toHaveLength(0);
  expect(apiCalls.filter((call) => call.method === "answerCallbackQuery")).toHaveLength(1);
});

test("profile ensures the fisher before profile reads and binds keyboard ownership", async () => {
  const { repo, calls: repoCalls } = createRepoFake();
  const apiCalls: ApiCall[] = [];
  const bot = createBot(repo, apiCalls);
  await bot.handleUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      date: 1,
      chat: { id: -100, type: "group", title: "Test" },
      from: { id: 11, is_bot: false, first_name: "Owner" },
      text: "/profile",
      entities: [{ offset: 0, length: 8, type: "bot_command" }],
    },
  } as never);

  expect(repoCalls.slice(0, 4)).toEqual(["ensureFisher", "getFisher", "getInventoryPage", "getEquippedRodId"]);
  const sent = apiCalls.find((call) => call.method === "sendMessage");
  expect(JSON.stringify(sent?.payload)).toContain('"ephemeral_message_parameters":{"receiver_user_id":11}');
  expect(JSON.stringify(sent?.payload.reply_markup)).toContain("upg:11:fish:1");
  expect(apiCalls).toContainEqual({ method: "deleteMessage", payload: { chat_id: -100, message_id: 1 } });
});

test("purchase and equip failures redraw rod details with precise feedback", async () => {
  const { repo } = createRepoFake();
  const apiCalls: ApiCall[] = [];
  repo.purchaseRod = async () => ({ status: "insufficient_fish", point: 2, required: 2, available: 0 });
  const bot = createBot(repo, apiCalls);
  await bot.handleUpdate(callbackUpdate(11, 11, buildCallbackData(11, { kind: "buy", rodId: "carbon" })) as never);
  expect(String(apiCalls.find((call) => call.method === "editEphemeralMessageText")?.payload.text)).toContain(
    "Не хватает рыбы «Редкая»: нужно 2, доступно 0.",
  );
  expect(apiCalls.filter((call) => call.method === "answerCallbackQuery")).toHaveLength(1);

  apiCalls.length = 0;
  repo.equipRod = async () => ({ status: "not_owned" });
  await bot.handleUpdate(callbackUpdate(11, 11, buildCallbackData(11, { kind: "equip", rodId: "carbon" })) as never);
  expect(String(apiCalls.find((call) => call.method === "editEphemeralMessageText")?.payload.text)).toContain("Эта удочка не куплена.");
  expect(apiCalls.filter((call) => call.method === "answerCallbackQuery")).toHaveLength(1);
});
