import { afterEach, expect, jest, spyOn, test } from "bun:test";
import { Bot } from "grammy";
import type { Chat, Update, User } from "grammy/types";
import type { BotContext } from "../../bot.ts";
import type { Config } from "../../config.ts";
import type { CatchInsert, CooldownRow, Repo } from "../../db/index.ts";
import { getCatalog, setCatalog } from "./catalog.ts";
import { registerGroupCommands } from "./commands.ts";

type CommandChat = Extract<Chat, { type: "group" | "private" | "supergroup" }>;
type FixtureUser = { id: number; first_name: string; is_bot?: boolean };

const CFG: Config = {
  botToken: "0:test",
  adminUserId: 1,
  catchSuccessChance: 50,
  catchDelaySeconds: 0,
  curseDropChance: 0,
  databaseUrl: "postgres://localhost/fishbot_test",
};

const GROUP_CHAT: CommandChat = { id: -100, type: "group", title: "Рыбаки" };
const PRIVATE_CHAT: CommandChat = { id: 7, type: "private", first_name: "Рыбак" };
const ADMIN: FixtureUser = { id: 1, first_name: "Влад" };
const PLAYER: FixtureUser = { id: 9, first_name: "Игрок" };

const FULL_CATALOG = [
  [{ name: "Окунь", rarity: "Обычный", point: 1 }],
  [{ name: "Лещ", rarity: "Редкий", point: 2 }],
  [{ name: "Карп", rarity: "Эпический", point: 3 }],
  [{ name: "Сом", rarity: "Легендарный", point: 4 }],
  [{ name: "Акула", rarity: "Мифическая", point: 5 }],
  [{ name: "Кит", rarity: "Радужная", point: 6 }],
];

// Deterministic tail consumed by generateSize's beta sample.
const SIZE_RANDOMS = [0.5, 0.25, 0.5, 0.5, 0.25, 0.5];

type UpdateSpec = {
  updateId: number;
  text: string;
  chat?: CommandChat;
  from?: FixtureUser;
  replyTo?: FixtureUser;
};
function toUser(user: FixtureUser): User {
  return { id: user.id, is_bot: user.is_bot ?? false, first_name: user.first_name };
}

function commandUpdate(spec: UpdateSpec): Update {
  const chat = spec.chat ?? GROUP_CHAT;
  const from = toUser(spec.from ?? { id: 7, first_name: "Рыбак" });
  const entities = [{ type: "bot_command" as const, offset: 0, length: spec.text.split(/\s/)[0]!.length }];
  const replyTo =
    spec.replyTo === undefined
      ? undefined
      : {
          message_id: spec.updateId + 1000,
          date: 0,
          chat,
          from: toUser(spec.replyTo),
          reply_to_message: undefined,
        };
  return {
    update_id: spec.updateId,
    message: { message_id: spec.updateId, date: 0, chat, from, text: spec.text, entities, reply_to_message: replyTo },
  };
}

type FakeFisher = { userId: number; chatId: number; firstName: string; balance: number };

type FakeRepo = Repo & {
  calls: string[];
  fishers: Map<string, FakeFisher>;
  catchTimes: Map<string, number>;
  chanceUps: Set<string>;
  catches: CatchInsert[];
};

function createFakeRepo(): FakeRepo {
  const calls: string[] = [];
  const fishers = new Map<string, FakeFisher>();
  const catchTimes = new Map<string, number>();
  const chanceUps = new Set<string>();
  const catches: CatchInsert[] = [];
  const key = (userId: number, chatId: number) => `${userId}:${chatId}`;
  const unexpected = (name: string): never => {
    throw new Error(`Unexpected repo call in test: ${name}`);
  };
  return {
    calls,
    fishers,
    catchTimes,
    chanceUps,
    catches,
    async ensureFisher(userId, chatId, firstName) {
      calls.push("ensureFisher");
      if (!fishers.has(key(userId, chatId))) {
        fishers.set(key(userId, chatId), { userId, chatId, firstName, balance: 0 });
      }
    },
    async recordCatch(catch_) {
      calls.push("recordCatch");
      catches.push(catch_);
    },
    async deleteLastCatch(userId, chatId) {
      calls.push("deleteLastCatch");
      let index = -1;
      for (let i = 0; i < catches.length; i++) {
        const catch_ = catches[i]!;
        if (catch_.userId === userId && catch_.chatId === chatId) index = i;
      }
      if (index === -1) return null;
      const removed = catches.splice(index, 1)[0]!;
      return { fishName: removed.fishName, rarity: removed.rarity, point: removed.point, price: removed.price };
    },
    async getCatchTime(userId, chatId) {
      calls.push("getCatchTime");
      return catchTimes.get(key(userId, chatId)) ?? null;
    },
    async upsertCatchTime(userId, chatId, unixSeconds) {
      calls.push("upsertCatchTime");
      catchTimes.set(key(userId, chatId), unixSeconds);
    },
    async deleteCatchTime(userId, chatId) {
      calls.push("deleteCatchTime");
      catchTimes.delete(key(userId, chatId));
    },
    async deleteCatchTimes(chatId) {
      calls.push("deleteCatchTimes");
      let removed = 0;
      for (const rowKey of catchTimes.keys()) {
        if (rowKey.endsWith(`:${chatId}`)) {
          catchTimes.delete(rowKey);
          removed++;
        }
      }
      return removed;
    },
    async listChatIds() {
      return [];
    },
    async multiplyBalance(userId, chatId, multiplier) {
      calls.push("multiplyBalance");
      const fisher = fishers.get(key(userId, chatId));
      if (fisher === undefined) return 0;
      fisher.balance = fisher.balance * multiplier;
      return fisher.balance;
    },
    async listCatchTimes(chatId) {
      calls.push("listCatchTimes");
      const rows: CooldownRow[] = [];
      for (const [rowKey, lastCatchTime] of catchTimes) {
        const fisher = fishers.get(rowKey);
        if (fisher === undefined || fisher.chatId !== chatId) continue;
        rows.push({ userId: fisher.userId, firstName: fisher.firstName, lastCatchTime });
      }
      return rows.sort((a, b) => a.firstName.localeCompare(b.firstName) || a.userId - b.userId);
    },
    async grantChanceUp(userId, chatId) {
      calls.push("grantChanceUp");
      chanceUps.add(key(userId, chatId));
    },
    async hasChanceUp(userId, chatId) {
      calls.push("hasChanceUp");
      return chanceUps.has(key(userId, chatId));
    },
    async consumeChanceUp(userId, chatId) {
      calls.push("consumeChanceUp");
      return chanceUps.delete(key(userId, chatId));
    },
    async getFisher(userId, chatId) {
      calls.push("getFisher");
      return fishers.get(key(userId, chatId)) ?? null;
    },
    async getInventoryPage() {
      return unexpected("getInventoryPage");
    },
    async getRarityInventory() {
      return unexpected("getRarityInventory");
    },
    async getRaritySalePreview() {
      return unexpected("getRaritySalePreview");
    },
    async sellFish() {
      return unexpected("sellFish");
    },
    async sellRarity() {
      return unexpected("sellRarity");
    },
    async purchaseRod() {
      return unexpected("purchaseRod");
    },
    async listPurchasedRodIds() {
      return unexpected("listPurchasedRodIds");
    },
    async equipRod() {
      return unexpected("equipRod");
    },
    async listTemplates() {
      return unexpected("listTemplates");
    },
    async getEquippedRodId() {
      calls.push("getEquippedRodId");
      return "basic";
    },
    async replaceAllTemplates() {
      return unexpected("replaceAllTemplates");
    },
    async getTopFishers() {
      return unexpected("getTopFishers");
    },
    async sumUserFishPrice() {
      return unexpected("sumUserFishPrice");
    },
    async countUserFishes() {
      return unexpected("countUserFishes");
    },
    async countUserFishesByRarity() {
      return unexpected("countUserFishesByRarity");
    },
    async insertTemplate() {
      return unexpected("insertTemplate");
    },
    async deleteTemplate() {
      return unexpected("deleteTemplate");
    },
    async loadAllTemplates() {
      return unexpected("loadAllTemplates");
    },
    async getFishingNet() {
      return unexpected("getFishingNet");
    },
    async castFishingNet() {
      return unexpected("castFishingNet");
    },
    async collectFishingNet() {
      return unexpected("collectFishingNet");
    },
    async listReadyUnnotifiedFishingNets() {
      return unexpected("listReadyUnnotifiedFishingNets");
    },
    async markFishingNetReadyNotified() {
      return unexpected("markFishingNetReadyNotified");
    },
    async trackBotMessage() {
      return unexpected("trackBotMessage");
    },
    async listRecentBotMessageIds() {
      return unexpected("listRecentBotMessageIds");
    },
    async markBotMessageDeleted() {
      return unexpected("markBotMessageDeleted");
    },
    async createTrade() {
      return unexpected("createTrade");
    },
    async getTrade() {
      return unexpected("getTrade");
    },
    async declineTrade() {
      return unexpected("declineTrade");
    },
    async acceptTrade() {
      return unexpected("acceptTrade");
    },
  };
}

function createTestBot(cfg: Config = CFG, repo: FakeRepo = createFakeRepo()): {
  bot: Bot<BotContext>;
  sentTexts: string[];
  repo: FakeRepo;
} {
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
  registerGroupCommands(bot, cfg, repo);
  return { bot, sentTexts, repo };
}

function mockRandom(values: readonly number[]): void {
  let index = 0;
  spyOn(Math, "random").mockImplementation(() => {
    const value = values[index++];
    if (value === undefined) throw new Error("Test did not provide enough random values");
    return value;
  });
}

afterEach(() => {
  setCatalog([]);
  jest.restoreAllMocks();
});

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

  await bot.handleUpdate(commandUpdate({ updateId: 1, text: "/fishes" }));

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

  await bot.handleUpdate(commandUpdate({ updateId: 2, text: "/fishes", chat: PRIVATE_CHAT }));

  expect(sentTexts).toEqual([]);
});

test("/cdr removes only the replied player's cooldown in the current chat", async () => {
  const { bot, sentTexts, repo } = createTestBot();
  repo.catchTimes.set("9:-100", 1_000);
  repo.catchTimes.set("9:-200", 1_000);
  repo.catchTimes.set("8:-100", 1_000);

  await bot.handleUpdate(commandUpdate({ updateId: 3, text: "/cdr", from: ADMIN, replyTo: PLAYER }));

  expect(sentTexts).toEqual(["Кулдаун для Игрок снят"]);
  expect(repo.calls).toEqual(["deleteCatchTime"]);
  expect(repo.catchTimes.has("9:-100")).toBe(false);
  expect(repo.catchTimes.has("9:-200")).toBe(true);
  expect(repo.catchTimes.has("8:-100")).toBe(true);
});

test("/cdr without an eligible replied user explains the required usage", async () => {
  const { bot, sentTexts, repo } = createTestBot();
  const BOT_TARGET: FixtureUser = { id: 42, first_name: "FishBot", is_bot: true };

  await bot.handleUpdate(commandUpdate({ updateId: 4, text: "/cdr", from: ADMIN }));
  await bot.handleUpdate(commandUpdate({ updateId: 5, text: "/cdr", from: ADMIN, replyTo: BOT_TARGET }));

  expect(sentTexts).toEqual([
    "Ответьте на сообщение пользователя командой /cdr",
    "Ответьте на сообщение пользователя командой /cdr",
  ]);
  expect(repo.calls).toEqual([]);
});

test("admin commands from non-owners or in private chats are silently ignored", async () => {
  setCatalog(FULL_CATALOG);
  const { bot, sentTexts, repo } = createTestBot();

  await bot.handleUpdate(commandUpdate({ updateId: 6, text: "/cdr", from: PLAYER, replyTo: PLAYER }));
  await bot.handleUpdate(commandUpdate({ updateId: 7, text: "/cd", from: PLAYER }));
  await bot.handleUpdate(commandUpdate({ updateId: 8, text: "/fakefish", from: PLAYER }));
  await bot.handleUpdate(commandUpdate({ updateId: 9, text: "/chanceup", from: PLAYER, replyTo: PLAYER }));
  await bot.handleUpdate(commandUpdate({ updateId: 10, text: "/cdr", from: ADMIN, chat: PRIVATE_CHAT, replyTo: PLAYER }));
  await bot.handleUpdate(commandUpdate({ updateId: 11, text: "/cd", from: ADMIN, chat: PRIVATE_CHAT }));
  await bot.handleUpdate(commandUpdate({ updateId: 200, text: "/cdr_all", from: PLAYER }));
  await bot.handleUpdate(commandUpdate({ updateId: 201, text: "/cdr_all", from: ADMIN, chat: PRIVATE_CHAT }));
  await bot.handleUpdate(commandUpdate({ updateId: 204, text: "/cr", from: PLAYER, replyTo: PLAYER }));
  await bot.handleUpdate(commandUpdate({ updateId: 205, text: "/cr", from: ADMIN, chat: PRIVATE_CHAT, replyTo: PLAYER }));
  await bot.handleUpdate(commandUpdate({ updateId: 12, text: "/fakefish", from: ADMIN, chat: PRIVATE_CHAT }));
  await bot.handleUpdate(
    commandUpdate({ updateId: 13, text: "/chanceup", from: ADMIN, chat: PRIVATE_CHAT, replyTo: PLAYER }),
  );

  expect(sentTexts).toEqual([]);
  expect(repo.calls).toEqual([]);
});


test("/cdr_all removes every cooldown in the current chat only", async () => {
  const { bot, sentTexts, repo } = createTestBot();
  repo.catchTimes.set("9:-100", 1_000);
  repo.catchTimes.set("8:-100", 1_000);
  repo.catchTimes.set("9:-200", 1_000);

  await bot.handleUpdate(commandUpdate({ updateId: 202, text: "/cdr_all", from: ADMIN }));

  expect(sentTexts).toEqual(["Кулдауны сняты для всех (2)"]);
  expect(repo.calls).toEqual(["deleteCatchTimes"]);
  expect(repo.catchTimes.has("9:-100")).toBe(false);
  expect(repo.catchTimes.has("8:-100")).toBe(false);
  expect(repo.catchTimes.has("9:-200")).toBe(true);
});

test("/cr spends the replied player's latest available catch without changing balance", async () => {
  const { bot, sentTexts, repo } = createTestBot();
  repo.fishers.set("9:-100", { userId: 9, chatId: -100, firstName: "Игрок", balance: 0 });
  repo.catches.push(
    {
      username: "Игрок",
      userId: 9,
      chatId: -100,
      fishName: "Окунь",
      rarity: "Обычный",
      point: 1,
      sizeCm: 15.36,
      weightG: 289.91,
      price: 214.5,
    },
    {
      username: "Игрок",
      userId: 9,
      chatId: -100,
      fishName: "Лещ",
      rarity: "Редкий",
      point: 2,
      sizeCm: 27.14,
      weightG: 1599.26,
      price: 719.85,
    },
  );

  await bot.handleUpdate(commandUpdate({ updateId: 206, text: "/cr", from: ADMIN, replyTo: PLAYER }));

  expect(sentTexts).toEqual(["Последний улов для Игрок удалён администратором из инвентаря: Лещ (Редкий)"]);
  expect(repo.calls).toEqual(["deleteLastCatch"]);
  expect(repo.catches).toHaveLength(1);
  expect(repo.catches[0]!.fishName).toBe("Окунь");
  expect(repo.fishers.get("9:-100")!.balance).toBe(0);
});

test("/cr without a reply or without catches changes no state", async () => {
  const { bot, sentTexts, repo } = createTestBot();
  repo.fishers.set("9:-100", { userId: 9, chatId: -100, firstName: "Игрок", balance: 0 });

  await bot.handleUpdate(commandUpdate({ updateId: 207, text: "/cr", from: ADMIN }));
  await bot.handleUpdate(commandUpdate({ updateId: 208, text: "/cr", from: ADMIN, replyTo: PLAYER }));

  expect(sentTexts).toEqual([
    "Ответьте на сообщение пользователя командой /cr",
    "У Игрок нет пойманных рыб",
  ]);
  expect(repo.catches).toHaveLength(0);
  expect(repo.fishers.get("9:-100")!.balance).toBe(0);
});
test("/cdr_all reports absence when no cooldowns exist", async () => {
  const { bot, sentTexts, repo } = createTestBot();

  await bot.handleUpdate(commandUpdate({ updateId: 203, text: "/cdr_all", from: ADMIN }));

  expect(sentTexts).toEqual(["Кулдауны пока отсутствуют"]);
  expect(repo.catchTimes.size).toBe(0);
});
test("/cd lists ceiling minutes for active cooldowns and 0 for expired ones", async () => {
  const cfg: Config = { ...CFG, catchDelaySeconds: 3600 };
  const { bot, sentTexts, repo } = createTestBot(cfg);
  const now = 10_000_000;
  const nowSpy = spyOn(Date, "now").mockReturnValue(now * 1000);
  repo.fishers.set("8:-100", { userId: 8, chatId: -100, firstName: "Анна<script>", balance: 0 });
  repo.fishers.set("9:-100", { userId: 9, chatId: -100, firstName: "Боб", balance: 0 });
  repo.catchTimes.set("8:-100", now - 7200);
  repo.catchTimes.set("9:-100", now - 1801);

  await bot.handleUpdate(commandUpdate({ updateId: 14, text: "/cd", from: ADMIN }));

  nowSpy.mockRestore();
  expect(sentTexts).toEqual(["🐟 <b>Кулдауны</b>\n• <b>Анна&lt;script&gt;</b> — 0 мин.\n• <b>Боб</b> — 30 мин."]);
});

test("/cd reports absence when no tracked cooldowns exist", async () => {
  const { bot, sentTexts } = createTestBot();

  await bot.handleUpdate(commandUpdate({ updateId: 15, text: "/cd", from: ADMIN }));

  expect(sentTexts).toEqual(["Кулдауны пока отсутствуют"]);
});

test("/fakefish shows one high-tier catch card without touching any state", async () => {
  setCatalog(FULL_CATALOG);
  const { bot, sentTexts, repo } = createTestBot();
  mockRandom([0, 0, ...SIZE_RANDOMS]);

  await bot.handleUpdate(commandUpdate({ updateId: 16, text: "/fakefish", from: ADMIN }));

  expect(sentTexts).toHaveLength(1);
  expect(sentTexts[0]!.startsWith("Влад\n")).toBe(true);
  expect(sentTexts[0]).toContain("<b>Имя:</b> Акула");
  expect(sentTexts[0]).toContain("<b>Редкость:</b> Мифическая");
  expect(repo.calls).toEqual([]);
  expect(repo.catchTimes.size).toBe(0);
  expect(repo.fishers.size).toBe(0);
  expect(repo.chanceUps.size).toBe(0);
  expect(repo.catches).toHaveLength(0);
});

test("/fakefish without point-5/6 templates reports the missing catalog", async () => {
  setCatalog([[{ name: "Окунь", rarity: "Обычный", point: 1 }]]);
  const { bot, sentTexts, repo } = createTestBot();

  await bot.handleUpdate(commandUpdate({ updateId: 17, text: "/fakefish", from: ADMIN }));

  expect(sentTexts).toEqual(["В списке нет рыб редкости 5 или 6"]);
  expect(repo.calls).toEqual([]);
});

test("/chanceup grants one pending bonus to the replied player and never stacks", async () => {
  setCatalog(FULL_CATALOG);
  const { bot, sentTexts, repo } = createTestBot();

  await bot.handleUpdate(commandUpdate({ updateId: 18, text: "/chanceup", from: ADMIN, replyTo: PLAYER }));
  await bot.handleUpdate(commandUpdate({ updateId: 19, text: "/chanceup", from: ADMIN, replyTo: PLAYER }));

  expect(sentTexts).toEqual([
    "Шанс для Игрок повышен: следующая разрешённая /fish гарантированно поймает рыбу редкости 2–6.",
    "Шанс для Игрок повышен: следующая разрешённая /fish гарантированно поймает рыбу редкости 2–6.",
  ]);
  expect(repo.chanceUps.has("9:-100")).toBe(true);
  expect(repo.chanceUps.size).toBe(1);
});

test("/chanceup without a reply or without eligible templates changes no state", async () => {
  const { bot, sentTexts, repo } = createTestBot();

  await bot.handleUpdate(commandUpdate({ updateId: 20, text: "/chanceup", from: ADMIN }));
  setCatalog([[{ name: "Окунь", rarity: "Обычный", point: 1 }]]);
  await bot.handleUpdate(commandUpdate({ updateId: 21, text: "/chanceup", from: ADMIN, replyTo: PLAYER }));

  expect(sentTexts).toEqual([
    "Ответьте на сообщение пользователя командой /chanceup",
    "В списке нет рыб редкости 2–6",
  ]);
  expect(repo.chanceUps.size).toBe(0);
});

test("/fish keeps a granted bonus across a blocked attempt and consumes it on the next allowed one", async () => {
  setCatalog(FULL_CATALOG);
  const cfg: Config = { ...CFG, catchDelaySeconds: 3600 };
  const { bot, sentTexts, repo } = createTestBot(cfg);
  const start = 10_000_000;
  const nowSpy = spyOn(Date, "now").mockReturnValue(start * 1000);

  await bot.handleUpdate(commandUpdate({ updateId: 22, text: "/chanceup", from: ADMIN, replyTo: PLAYER }));

  // Mid-cooldown attempt: blocked, bonus untouched, no consumption attempted.
  repo.catchTimes.set("9:-100", start - 1800);
  mockRandom([]);
  await bot.handleUpdate(commandUpdate({ updateId: 23, text: "/fish", from: PLAYER }));
  expect(sentTexts.at(-1)).toContain("Вы недавно ловили рыбу");
  expect(repo.chanceUps.has("9:-100")).toBe(true);
  expect(repo.calls).not.toContain("consumeChanceUp");
  expect(repo.catches).toHaveLength(0);

  // Cooldown elapsed: the allowed attempt consumes the bonus and lands on point 2.
  nowSpy.mockReturnValue((start + 1801) * 1000);
  mockRandom([0, 0, ...SIZE_RANDOMS]);
  await bot.handleUpdate(commandUpdate({ updateId: 24, text: "/fish", from: PLAYER }));
  expect(repo.catches).toHaveLength(1);
  expect(repo.catches[0]!.point).toBe(2);
  expect(repo.catches[0]!.fishName).toBe("Лещ");
  expect(repo.catches[0]!.userId).toBe(9);
  expect(repo.catches[0]!.chatId).toBe(-100);
  expect(repo.chanceUps.has("9:-100")).toBe(false);
  expect(repo.calls.filter((call) => call === "recordCatch")).toHaveLength(1);
  expect(repo.fishers.get("9:-100")!.balance).toBe(0);
  expect(sentTexts.at(-1)).toContain("добавлена в инвентарь");

  // A later allowed attempt follows normal generation: point 1 under normal weights.
  nowSpy.mockReturnValue((start + 1801 + 3601) * 1000);
  mockRandom([0, 0, 0, ...SIZE_RANDOMS]);
  await bot.handleUpdate(commandUpdate({ updateId: 25, text: "/fish", from: PLAYER }));
  expect(repo.catches).toHaveLength(2);
  expect(repo.catches[1]!.point).toBe(1);
  expect(repo.catches[1]!.fishName).toBe("Окунь");
  expect(repo.calls.filter((call) => call === "consumeChanceUp")).toHaveLength(1);
  expect(sentTexts.at(-1)).toContain("<b>Имя:</b> Окунь");

  nowSpy.mockRestore();
});

test("/fish defers a granted bonus while the catalog lacks rarity 2-6 templates", async () => {
  const cfg: Config = { ...CFG, catchDelaySeconds: 3600 };
  const { bot, sentTexts, repo } = createTestBot(cfg);
  const start = 20_000_000;
  const nowSpy = spyOn(Date, "now").mockReturnValue(start * 1000);

  setCatalog(FULL_CATALOG);
  await bot.handleUpdate(commandUpdate({ updateId: 26, text: "/chanceup", from: ADMIN, replyTo: PLAYER }));

  setCatalog([[{ name: "Окунь", rarity: "Обычный", point: 1 }]]);
  mockRandom([]);
  await bot.handleUpdate(commandUpdate({ updateId: 27, text: "/fish", from: PLAYER }));
  expect(sentTexts.at(-1)).toBe("В списке нет рыб редкости 2–6");
  expect(repo.chanceUps.has("9:-100")).toBe(true);
  expect(repo.calls).not.toContain("ensureFisher");
  expect(repo.calls).not.toContain("consumeChanceUp");
  expect(repo.catchTimes.size).toBe(0);

  // Eligible catalog restored: the still-pending bonus delivers the promised boosted catch.
  setCatalog(FULL_CATALOG);
  nowSpy.mockReturnValue((start + 1) * 1000);
  mockRandom([0, 0, ...SIZE_RANDOMS]);
  await bot.handleUpdate(commandUpdate({ updateId: 28, text: "/fish", from: PLAYER }));
  expect(repo.catches).toHaveLength(1);
  expect(repo.catches[0]!.point).toBe(2);

  nowSpy.mockRestore();
});

test("/fish heavy_net curse doubles the fresh cooldown while the catch stays available", async () => {
  setCatalog(FULL_CATALOG);
  const cfg: Config = { ...CFG, catchDelaySeconds: 3600, curseDropChance: 20 };
  const { bot, sentTexts, repo } = createTestBot(cfg);
  const start = 30_000_000;
  const nowSpy = spyOn(Date, "now").mockReturnValue(start * 1000);

  mockRandom([0, 0, 0, ...SIZE_RANDOMS, 0, 0]);
  await bot.handleUpdate(commandUpdate({ updateId: 300, text: "/fish", from: PLAYER }));

  expect(sentTexts).toHaveLength(1);
  expect(sentTexts[0]).toContain("<b>Имя:</b> Окунь");
  expect(sentTexts[0]!.endsWith(
    "\n\n🪢 <b>Проклятие тяжёлой сети</b>\nКулдаун увеличен до 2часов 0минут 0секунд.",
  )).toBe(true);
  expect(repo.catches).toHaveLength(1);
  expect(repo.catchTimes.get("9:-100")).toBe(start + 3600);

  // One normal hour later: still inside the doubled cooldown.
  nowSpy.mockReturnValue((start + 3600) * 1000);
  mockRandom([]);
  await bot.handleUpdate(commandUpdate({ updateId: 301, text: "/fish", from: PLAYER }));
  expect(sentTexts.at(-1)).toContain("Вы недавно ловили рыбу");
  expect(repo.catches).toHaveLength(1);
  expect(repo.catchTimes.get("9:-100")).toBe(start + 3600);

  // Two hours later: the doubled cooldown has fully elapsed.
  nowSpy.mockReturnValue((start + 7201) * 1000);
  mockRandom([0, 0, 0, ...SIZE_RANDOMS, 0.9]);
  await bot.handleUpdate(commandUpdate({ updateId: 302, text: "/fish", from: PLAYER }));
  expect(repo.catches).toHaveLength(2);
  expect(sentTexts.at(-1)).toContain("<b>Имя:</b> Окунь");

  nowSpy.mockRestore();
});

test("/fish second_cast curse clears the fresh cooldown so the next /fish casts immediately", async () => {
  setCatalog(FULL_CATALOG);
  const cfg: Config = { ...CFG, catchDelaySeconds: 3600, curseDropChance: 20 };
  const { bot, sentTexts, repo } = createTestBot(cfg);
  const start = 40_000_000;
  const nowSpy = spyOn(Date, "now").mockReturnValue(start * 1000);

  mockRandom([0, 0, 0, ...SIZE_RANDOMS, 0, 0.32]);
  await bot.handleUpdate(commandUpdate({ updateId: 303, text: "/fish", from: PLAYER }));

  expect(sentTexts).toHaveLength(1);
  expect(sentTexts[0]).toContain("<b>Имя:</b> Окунь");
  expect(sentTexts[0]!.endsWith(
    "\n\n🌀 <b>Проклятие второго заброса</b>\nВаш кулдаун снят: можно ловить снова.",
  )).toBe(true);
  expect(repo.catches).toHaveLength(1);
  expect(repo.catchTimes.has("9:-100")).toBe(false);

  // The just-created cooldown is gone: an immediate second /fish catches again.
  mockRandom([0, 0, 0, ...SIZE_RANDOMS, 0.9]);
  await bot.handleUpdate(commandUpdate({ updateId: 304, text: "/fish", from: PLAYER }));
  expect(repo.catches).toHaveLength(2);
  expect(sentTexts).toHaveLength(2);
  expect(sentTexts[1]).toContain("<b>Имя:</b> Окунь");
  expect(sentTexts[1]).not.toContain("Вы недавно ловили рыбу");

  nowSpy.mockRestore();
});

test("/fish storm_tide curse clears every cooldown in this chat only and reports the count", async () => {
  setCatalog(FULL_CATALOG);
  const cfg: Config = { ...CFG, catchDelaySeconds: 3600, curseDropChance: 100 };
  const { bot, sentTexts, repo } = createTestBot(cfg);
  const start = 50_000_000;
  const nowSpy = spyOn(Date, "now").mockReturnValue(start * 1000);
  repo.catchTimes.set("8:-100", start - 60);
  repo.catchTimes.set("9:-200", start - 60);

  mockRandom([0, 0, 0, ...SIZE_RANDOMS, 0, 0.64]);
  await bot.handleUpdate(commandUpdate({ updateId: 305, text: "/fish", from: PLAYER }));

  expect(sentTexts).toHaveLength(1);
  expect(sentTexts[0]).toContain("<b>Имя:</b> Окунь");
  expect(sentTexts[0]!.endsWith(
    "\n\n🌊 <b>Проклятие штормового прилива</b>\nКулдауны сняты для всех в этом чате (2).",
  )).toBe(true);
  expect(repo.catches).toHaveLength(1);
  expect(repo.catchTimes.has("8:-100")).toBe(false);
  expect(repo.catchTimes.has("9:-200")).toBe(true);
  expect(repo.catchTimes.size).toBe(1);

  nowSpy.mockRestore();
});

test("/fish golden_scales curse multiplies only the catcher's chat balance, not the catch price", async () => {
  setCatalog(FULL_CATALOG);
  const cfg: Config = { ...CFG, curseDropChance: 20 };
  const { bot, sentTexts, repo } = createTestBot(cfg);
  const start = 60_000_000;
  const nowSpy = spyOn(Date, "now").mockReturnValue(start * 1000);
  repo.fishers.set("9:-100", { userId: 9, chatId: -100, firstName: "Игрок", balance: 250 });
  repo.fishers.set("9:-200", { userId: 9, chatId: -200, firstName: "Игрок", balance: 250 });

  mockRandom([0, 0, 0, ...SIZE_RANDOMS, 0, 0.69, 0.99]);
  await bot.handleUpdate(commandUpdate({ updateId: 306, text: "/fish", from: PLAYER }));

  expect(sentTexts).toHaveLength(1);
  expect(sentTexts[0]).toContain("<b>Имя:</b> Окунь");
  expect(sentTexts[0]!.endsWith("\n\n🪙 <b>Проклятие золотой чешуи</b>\nВаш баланс умножен на ×1.2.")).toBe(true);
  expect(repo.catches).toHaveLength(1);
  expect(sentTexts[0]).toContain(`<b>Цена:</b> ${repo.catches[0]!.price}рублей`);
  expect(repo.fishers.get("9:-100")!.balance).toBeCloseTo(300, 10);
  expect(repo.fishers.get("9:-200")!.balance).toBe(250);
  // The money curse never touches the catch's own cooldown.
  expect(repo.catchTimes.get("9:-100")).toBe(start);

  nowSpy.mockRestore();
});
