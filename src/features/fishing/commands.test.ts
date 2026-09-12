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
  fishModifierDropChance: 0,
  eventTimeZone: "Europe/Moscow",
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

type FakeCooldown = { lastCatchTime: number; delaySeconds: number };

type FakeRepo = Repo & {
  calls: string[];
  fishers: Map<string, FakeFisher>;
  catchTimes: Map<string, FakeCooldown>;
  chanceUps: Set<string>;
  catches: CatchInsert[];
  announcements: { eventId: string; startedAt: number } | null;
};

/** Fake stored cooldown pair; CATCH_DELAY substitute defaults to one hour. */
function cd(lastCatchTime: number, delaySeconds = 3_600): FakeCooldown {
  return { lastCatchTime, delaySeconds };
}

function createFakeRepo(): FakeRepo {
  const calls: string[] = [];
  const fishers = new Map<string, FakeFisher>();
  const catchTimes = new Map<string, FakeCooldown>();
  const chanceUps = new Set<string>();
  const catches: CatchInsert[] = [];
  let announcements: { eventId: string; startedAt: number } | null = null;
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
    get announcements() {
      return announcements;
    },
    set announcements(value: { eventId: string; startedAt: number } | null) {
      announcements = value;
    },
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
      return {
        fishName: removed.fishName,
        rarity: removed.rarity,
        point: removed.point,
        price: removed.price,
        fishModifierId: removed.fishModifierId,
        fishModifierName: removed.fishModifierName,
        fishModifierRarity: removed.fishModifierRarity,
      };
    },
    async getCatchTime(userId, chatId, defaultDelaySeconds) {
      calls.push("getCatchTime");
      const stored = catchTimes.get(key(userId, chatId));
      if (stored === undefined) return null;
      return { lastCatchTime: stored.lastCatchTime, delaySeconds: stored.delaySeconds ?? defaultDelaySeconds };
    },
    async upsertCatchTime(userId, chatId, unixSeconds, delaySeconds) {
      calls.push("upsertCatchTime");
      catchTimes.set(key(userId, chatId), { lastCatchTime: unixSeconds, delaySeconds });
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
    async listCatchTimes(chatId, defaultDelaySeconds) {
      calls.push("listCatchTimes");
      const rows: CooldownRow[] = [];
      for (const [rowKey, cooldown] of catchTimes) {
        const fisher = fishers.get(rowKey);
        if (fisher === undefined || fisher.chatId !== chatId) continue;
        rows.push({
          userId: fisher.userId,
          firstName: fisher.firstName,
          lastCatchTime: cooldown.lastCatchTime,
          delaySeconds: cooldown.delaySeconds ?? defaultDelaySeconds,
        });
      }
      return rows.sort((a, b) => a.firstName.localeCompare(b.firstName) || a.userId - b.userId);
    },
    async getTimeEventAnnouncement() {
      calls.push("getTimeEventAnnouncement");
      return announcements;
    },
    async setTimeEventAnnouncement(eventId, startedAt) {
      calls.push("setTimeEventAnnouncement");
      announcements = { eventId, startedAt };
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
    async getInventoryFish() {
      return unexpected("getInventoryFish");
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
    async removeInventoryFish() {
      return unexpected("removeInventoryFish");
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
    async removePurchasedRod() {
      return unexpected("removePurchasedRod");
    },
    async grantPurchasedRod() {
      return unexpected("grantPurchasedRod");
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
    async trackChatMessage() {
      return unexpected("trackChatMessage");
    },
    async listRecentClearableMessageIds() {
      return unexpected("listRecentClearableMessageIds");
    },
    async markChatMessageDeleted() {
      return unexpected("markChatMessageDeleted");
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

test("/fishes lists escaped fish names, rarities, normalized catch chances, and modifier odds in a group", async () => {
  setCatalog([
    [
      { name: "Окунь & <лещ>", rarity: "Обычный", point: 1 },
      { name: "Карась", rarity: "Обычный", point: 1 },
    ],
    [],
    [{ name: "Сом", rarity: "Эпический", point: 3 }],
  ]);
  const { bot, sentTexts } = createTestBot({ ...CFG, fishModifierDropChance: 12 });

  await bot.handleUpdate(commandUpdate({ updateId: 1, text: "/fishes" }));

  expect(sentTexts).toEqual([
    "🐟 <b>Список рыб</b>\n" +
      "<i>Шанс указан среди успешных уловов.</i>\n\n" +
      "• <b>Окунь &amp; &lt;лещ&gt;</b> — Обычный — 46.15%\n" +
      "• <b>Карась</b> — Обычный — 46.15%\n" +
      "• <b>Сом</b> — Эпический — 7.69%\n\n" +
      "✨ <b>Модификаторы</b> — 12% уловов\n" +
      "<i>Шанс указан среди модифицированных рыб.</i>\n\n" +
      "• <b>Упитанная</b> — Обычный — 37% — размер ×1.05 · цена ×1.1\n" +
      "• <b>Серебряная</b> — Необычный — 25% — размер ×1.1 · цена ×1.25\n" +
      "• <b>Золотая</b> — Редкий — 15% — размер ×1.15 · цена ×1.6\n" +
      "• <b>Электрическая</b> — Редкий — 9% — размер ×1.18 · цена ×1.85\n" +
      "• <b>Радужная</b> — Эпический — 6% — размер ×1.25 · цена ×2.5\n" +
      "• <b>Лунная</b> — Эпический — 4% — размер ×1.3 · цена ×3.25\n" +
      "• <b>Кристальная</b> — Легендарный — 2.5% — размер ×1.4 · цена ×4.5\n" +
      "• <b>Бездна</b> — Мифический — 1.5% — размер ×1.55 · цена ×7",
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
  repo.catchTimes.set("9:-100", cd(1_000));
  repo.catchTimes.set("9:-200", cd(1_000));
  repo.catchTimes.set("8:-100", cd(1_000));

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
  repo.catchTimes.set("9:-100", cd(1_000));
  repo.catchTimes.set("8:-100", cd(1_000));
  repo.catchTimes.set("9:-200", cd(1_000));

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
      fishModifierId: null,
      fishModifierName: null,
      fishModifierRarity: null,
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
      fishModifierId: null,
      fishModifierName: null,
      fishModifierRarity: null,
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
  repo.catchTimes.set("8:-100", cd(now - 7200, 3600));
  repo.catchTimes.set("9:-100", cd(now - 1801, 3600));

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
  repo.catchTimes.set("9:-100", cd(start - 1800, 3600));
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
  expect(repo.catchTimes.get("9:-100")).toEqual({ lastCatchTime: start + 3600, delaySeconds: 3600 });

  // One normal hour later: still inside the doubled cooldown.
  nowSpy.mockReturnValue((start + 3600) * 1000);
  mockRandom([]);
  await bot.handleUpdate(commandUpdate({ updateId: 301, text: "/fish", from: PLAYER }));
  expect(sentTexts.at(-1)).toContain("Вы недавно ловили рыбу");
  expect(repo.catches).toHaveLength(1);
  expect(repo.catchTimes.get("9:-100")).toEqual({ lastCatchTime: start + 3600, delaySeconds: 3600 });

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

  mockRandom([0, 0, 0, ...SIZE_RANDOMS, 0, 0.34]);
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
  expect(repo.catchTimes.get("9:-100")).toEqual({ lastCatchTime: start, delaySeconds: 0 });

  nowSpy.mockRestore();
});

test("/fish records the rolled modifier, shows it on the card, and stores its displayed values", async () => {
  setCatalog(FULL_CATALOG);
  const cfg: Config = { ...CFG, fishModifierDropChance: 100 };
  const { bot, sentTexts, repo } = createTestBot(cfg);
  spyOn(Date, "now").mockReturnValue(mskMs(2026, 9, 9, 9, 30));
  // Catch, rarity point, template, beta size tail, then the modifier drop
  // (always at 100%) and selection (62 lands on the golden band).
  mockRandom([0, 0, 0, ...SIZE_RANDOMS, 0, 0.62]);

  await bot.handleUpdate(commandUpdate({ updateId: 307, text: "/fish", from: PLAYER }));

  expect(repo.catches).toHaveLength(1);
  expect(repo.catches[0]).toMatchObject({
    fishName: "Окунь",
    fishModifierId: "golden",
    fishModifierName: "Золотая",
    fishModifierRarity: "Редкий",
  });
  expect(sentTexts).toHaveLength(1);
  expect(sentTexts[0]).toContain("<b>Модификатор:</b> Золотая (Редкий)");
  expect(sentTexts[0]).toContain("<b>Цена:</b> 355.25рублей");
});

test("/fish leaves no modifier trace for an unmodified catch", async () => {
  setCatalog(FULL_CATALOG);
  const { bot, sentTexts, repo } = createTestBot();
  spyOn(Date, "now").mockReturnValue(mskMs(2026, 9, 9, 9, 30));
  // The modifier roll is skipped entirely at 0%, so the tail stays unused.
  mockRandom([0, 0, 0, ...SIZE_RANDOMS]);

  await bot.handleUpdate(commandUpdate({ updateId: 308, text: "/fish", from: PLAYER }));

  expect(repo.catches).toHaveLength(1);
  expect(repo.catches[0]).toMatchObject({
    fishModifierId: null,
    fishModifierName: null,
    fishModifierRarity: null,
  });
  expect(sentTexts[0]).toContain("<b>Имя:</b> Окунь");
  expect(sentTexts[0]).not.toContain("Модификатор");
});

test("/fakefish shows a modifier by the usual rules without storing anything", async () => {
  setCatalog(FULL_CATALOG);
  const cfg: Config = { ...CFG, fishModifierDropChance: 100 };
  const { bot, sentTexts, repo } = createTestBot(cfg);
  mockRandom([0, 0, ...SIZE_RANDOMS, 0, 0.62]);

  await bot.handleUpdate(commandUpdate({ updateId: 309, text: "/fakefish", from: ADMIN }));

  expect(sentTexts).toHaveLength(1);
  expect(sentTexts[0]).toContain("<b>Имя:</b> Акула");
  expect(sentTexts[0]).toContain("<b>Модификатор:</b> Золотая (Редкий)");
  expect(repo.calls).toEqual([]);
  expect(repo.catches).toHaveLength(0);
});

/** UTC instant of the given Moscow wall-clock time (MSK is UTC+3 all year). */
function mskMs(year: number, month: number, day: number, hour: number, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour - 3, minute);
}

test("/fish during Рассветный клёв adds +20 percentage points to the success chance", async () => {
  setCatalog(FULL_CATALOG);
  const cfg: Config = { ...CFG, catchSuccessChance: 50, catchDelaySeconds: 3600 };
  const { bot, sentTexts, repo } = createTestBot(cfg);
  // Wednesday 06:30 MSK, inside the [06:00, 08:00) window.
  const nowSpy = spyOn(Date, "now").mockReturnValue(mskMs(2026, 9, 9, 6, 30));

  // 60 < 70 only succeeds with the event bonus; the base chance of 50 would miss.
  mockRandom([0.6, 0, 0, ...SIZE_RANDOMS]);
  await bot.handleUpdate(commandUpdate({ updateId: 400, text: "/fish", from: PLAYER }));

  expect(repo.catches).toHaveLength(1);
  expect(sentTexts[0]).toContain("Событие «Рассветный клёв»");

  nowSpy.mockRestore();
});

test("/fish outside events keeps the base success chance", async () => {
  setCatalog(FULL_CATALOG);
  const cfg: Config = { ...CFG, catchSuccessChance: 50, catchDelaySeconds: 3600 };
  const { bot, sentTexts, repo } = createTestBot(cfg);
  // Wednesday 09:30 MSK: no event is active.
  const nowSpy = spyOn(Date, "now").mockReturnValue(mskMs(2026, 9, 9, 9, 30));

  mockRandom([0.6]);
  await bot.handleUpdate(commandUpdate({ updateId: 401, text: "/fish", from: PLAYER }));

  expect(repo.catches).toHaveLength(0);
  expect(sentTexts).toEqual(["Игрок\n😫Упс похоже ты ничего не поймал😫"]);
  expect(repo.catchTimes.size).toBe(1); // the attempt still started a cooldown

  nowSpy.mockRestore();
});

test("/fish during Золотой час rolls rarity with the boosted weights", async () => {
  setCatalog(FULL_CATALOG);
  const cfg: Config = { ...CFG, catchDelaySeconds: 3600 };
  const { bot, sentTexts, repo } = createTestBot(cfg);
  // Wednesday 12:30 MSK, inside the [12:00, 13:00) window.
  const nowSpy = spyOn(Date, "now").mockReturnValue(mskMs(2026, 9, 9, 12, 30));

  // 75.1 falls into golden hour point 3; under normal weights it would be point 2.
  mockRandom([0, 0.751, 0, ...SIZE_RANDOMS]);
  await bot.handleUpdate(commandUpdate({ updateId: 410, text: "/fish", from: PLAYER }));

  expect(repo.catches[0]!.point).toBe(3);
  expect(repo.catches[0]!.fishName).toBe("Карп");
  expect(sentTexts[0]).toContain("Событие «Золотой час»");

  nowSpy.mockRestore();
});

test("/fish during Штиль starts a halved cooldown that keeps its duration after the event", async () => {
  setCatalog(FULL_CATALOG);
  const cfg: Config = { ...CFG, catchDelaySeconds: 3600 };
  const { bot, sentTexts, repo } = createTestBot(cfg);
  // Wednesday 15:30 MSK, inside the [15:00, 16:00) window.
  const start = mskMs(2026, 9, 9, 15, 30);
  const nowSpy = spyOn(Date, "now").mockReturnValue(start);

  mockRandom([0, 0, 0, ...SIZE_RANDOMS]);
  await bot.handleUpdate(commandUpdate({ updateId: 420, text: "/fish", from: PLAYER }));
  expect(repo.catches).toHaveLength(1);
  expect(repo.catchTimes.get("9:-100")).toEqual({ lastCatchTime: start / 1000, delaySeconds: 1800 });
  expect(sentTexts[0]).toContain("Событие «Штиль»");

  // Still inside the event window: the halved cooldown blocks with 800s left.
  nowSpy.mockReturnValue(start + 1000 * 1000);
  mockRandom([]);
  await bot.handleUpdate(commandUpdate({ updateId: 421, text: "/fish", from: PLAYER }));
  expect(sentTexts.at(-1)).toContain("Вы недавно ловили рыбу");
  expect(sentTexts.at(-1)).toContain("13минут 20секунд");
  expect(repo.catchTimes.get("9:-100")).toEqual({ lastCatchTime: start / 1000, delaySeconds: 1800 });

  // The event is over, but the stored 1800s duration still governs expiry.
  nowSpy.mockReturnValue(start + 1801 * 1000);
  mockRandom([0, 0, 0, ...SIZE_RANDOMS]);
  await bot.handleUpdate(commandUpdate({ updateId: 422, text: "/fish", from: PLAYER }));
  expect(repo.catches).toHaveLength(2);
  // The fresh cooldown written outside the event uses the full configured delay.
  expect(repo.catchTimes.get("9:-100")).toEqual({ lastCatchTime: (start + 1801 * 1000) / 1000, delaySeconds: 3600 });

  nowSpy.mockRestore();
});

test("/fish during Ночной трофей records high-tier prices multiplied by 1.5", async () => {
  setCatalog(FULL_CATALOG);
  const cfg: Config = { ...CFG, catchDelaySeconds: 3600 };
  const { bot, sentTexts, repo } = createTestBot(cfg);
  // Wednesday 22:30 MSK, inside the [22:00, 23:00) window.
  const nowSpy = spyOn(Date, "now").mockReturnValue(mskMs(2026, 9, 9, 22, 30));

  // 99.7 lands on point 5 under normal weights; base price 25414.06 becomes 38121.09.
  mockRandom([0, 0.997, 0, ...SIZE_RANDOMS]);
  await bot.handleUpdate(commandUpdate({ updateId: 430, text: "/fish", from: PLAYER }));

  expect(repo.catches[0]!.point).toBe(5);
  expect(repo.catches[0]!.price).toBe(38121.09);
  expect(sentTexts[0]).toContain("<b>Цена:</b> 38121.09рублей");
  expect(sentTexts[0]).toContain("Событие «Ночной трофей»");

  nowSpy.mockRestore();
});

test("/fish during Лунная заводь guarantees rarity 2-6 and keeps the personal bonus", async () => {
  setCatalog(FULL_CATALOG);
  const cfg: Config = { ...CFG, catchDelaySeconds: 3600 };
  const { bot, sentTexts, repo } = createTestBot(cfg);
  // Saturday 00:30 MSK, inside the weekend [00:00, 02:00) window.
  const nowSpy = spyOn(Date, "now").mockReturnValue(mskMs(2026, 9, 12, 0, 30));
  repo.chanceUps.add("9:-100");

  mockRandom([0, 0, 0, ...SIZE_RANDOMS]);
  await bot.handleUpdate(commandUpdate({ updateId: 440, text: "/fish", from: PLAYER }));

  expect(repo.catches[0]!.point).toBe(2);
  expect(repo.chanceUps.has("9:-100")).toBe(true);
  expect(repo.calls).not.toContain("consumeChanceUp");
  expect(sentTexts[0]).toContain("Событие «Лунная заводь»");

  // After the event the stored personal bonus is still pending and gets consumed.
  nowSpy.mockReturnValue(mskMs(2026, 9, 12, 9, 30));
  mockRandom([0, 0, 0, ...SIZE_RANDOMS]);
  await bot.handleUpdate(commandUpdate({ updateId: 441, text: "/fish", from: PLAYER }));
  expect(repo.calls.filter((call) => call === "consumeChanceUp")).toHaveLength(1);
  expect(repo.chanceUps.has("9:-100")).toBe(false);
  expect(repo.catches[1]!.point).toBe(2);

  nowSpy.mockRestore();
});

test("/event reports the active event, its end time, and the next event", async () => {
  const { bot, sentTexts } = createTestBot();
  const nowSpy = spyOn(Date, "now").mockReturnValue(mskMs(2026, 9, 9, 12, 30));

  await bot.handleUpdate(commandUpdate({ updateId: 450, text: "/event", from: PLAYER }));
  expect(sentTexts[0]).toBe(
    "🎣 <b>События</b>\n" +
      "Сейчас: ✨ <b>Золотой час</b> — до 13:00\n" +
      "усиленные шансы редкой рыбы\n" +
      "Следующее: 🌊 <b>Штиль</b> — 15:00",
  );

  nowSpy.mockReturnValue(mskMs(2026, 9, 9, 10, 0));
  await bot.handleUpdate(commandUpdate({ updateId: 451, text: "/event", from: PLAYER }));
  expect(sentTexts[1]).toBe(
    "🎣 <b>События</b>\n" +
      "Сейчас активных событий нет.\n" +
      "Следующее: ✨ <b>Золотой час</b> — 12:00",
  );

  nowSpy.mockRestore();
});

test("/event is ignored in private chats", async () => {
  const { bot, sentTexts } = createTestBot();

  await bot.handleUpdate(commandUpdate({ updateId: 460, text: "/event", chat: PRIVATE_CHAT }));

  expect(sentTexts).toEqual([]);
});

test("/events lists the full schedule and marks the running event", async () => {
  const { bot, sentTexts } = createTestBot();
  // Wednesday 12:30 MSK: golden hour is running.
  const nowSpy = spyOn(Date, "now").mockReturnValue(mskMs(2026, 9, 9, 12, 30));

  await bot.handleUpdate(commandUpdate({ updateId: 465, text: "/events", from: PLAYER }));

  expect(sentTexts[0]).toBe(
    "🎣 <b>Расписание событий</b>\n" +
      "<i>Время указано для часового пояса Europe/Moscow.</i>\n\n" +
      "• 🌅 <b>Рассветный клёв</b> — каждый день, 06:00–08:00\n" +
      "шанс успешной поклёвки +20 п.п.\n" +
      "• ✨ <b>Золотой час</b> — каждый день, 12:00–13:00 — идёт сейчас\n" +
      "усиленные шансы редкой рыбы\n" +
      "• 🌊 <b>Штиль</b> — каждый день, 15:00–16:00\n" +
      "кулдаун /fish вдвое короче\n" +
      "• 🌙 <b>Ночной трофей</b> — каждый день, 22:00–23:00\n" +
      "цена рыб редкости 4–6 ×1.5\n" +
      "• 🌌 <b>Лунная заводь</b> — сб и вс, 00:00–02:00\n" +
      "улов гарантированно редкости 2–6, персональный буст не тратится",
  );

  // With nothing running, no entry carries the marker.
  nowSpy.mockReturnValue(mskMs(2026, 9, 9, 10, 0));
  await bot.handleUpdate(commandUpdate({ updateId: 466, text: "/events", from: PLAYER }));
  expect(sentTexts[1]).not.toContain("идёт сейчас");

  nowSpy.mockRestore();
});

test("/events is ignored in private chats", async () => {
  const { bot, sentTexts } = createTestBot();

  await bot.handleUpdate(commandUpdate({ updateId: 467, text: "/events", chat: PRIVATE_CHAT }));

  expect(sentTexts).toEqual([]);
});

test("/cd counts down by each stored cooldown duration, not the configured one", async () => {
  const cfg: Config = { ...CFG, catchDelaySeconds: 3600 };
  const { bot, sentTexts, repo } = createTestBot(cfg);
  const now = 10_000_000;
  const nowSpy = spyOn(Date, "now").mockReturnValue(now * 1000);
  repo.fishers.set("7:-100", { userId: 7, chatId: -100, firstName: "Вега", balance: 0 });
  repo.fishers.set("8:-100", { userId: 8, chatId: -100, firstName: "Анна<script>", balance: 0 });
  repo.fishers.set("9:-100", { userId: 9, chatId: -100, firstName: "Боб", balance: 0 });
  repo.fishers.set("10:-100", { userId: 10, chatId: -100, firstName: "Галя", balance: 0 });
  repo.catchTimes.set("8:-100", cd(now - 7200, 3600)); // expired long ago
  repo.catchTimes.set("9:-100", cd(now - 1801, 3600)); // 1799s left
  repo.catchTimes.set("7:-100", { lastCatchTime: now - 100, delaySeconds: undefined as unknown as number }); // legacy row → CATCH_DELAY
  repo.catchTimes.set("10:-100", cd(now - 500, 900)); // halved Штиль cooldown, 400s left

  await bot.handleUpdate(commandUpdate({ updateId: 470, text: "/cd", from: ADMIN }));

  nowSpy.mockRestore();
  expect(sentTexts).toEqual([
    "🐟 <b>Кулдауны</b>\n" +
      "• <b>Анна&lt;script&gt;</b> — 0 мин.\n" +
      "• <b>Боб</b> — 30 мин.\n" +
      "• <b>Вега</b> — 59 мин.\n" +
      "• <b>Галя</b> — 7 мин.",
  ]);
});
