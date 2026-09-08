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
    async addBalance(userId, chatId, delta) {
      calls.push("addBalance");
      const fisher = fishers.get(key(userId, chatId));
      if (fisher !== undefined) fisher.balance += delta;
    },
    async recordCatchWithBalance(catch_, delta) {
      calls.push("recordCatchWithBalance");
      catches.push(catch_);
      const fisher = fishers.get(key(catch_.userId, catch_.chatId));
      if (fisher !== undefined) fisher.balance += delta;
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
    async listTemplates() {
      return unexpected("listTemplates");
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
  await bot.handleUpdate(commandUpdate({ updateId: 12, text: "/fakefish", from: ADMIN, chat: PRIVATE_CHAT }));
  await bot.handleUpdate(
    commandUpdate({ updateId: 13, text: "/chanceup", from: ADMIN, chat: PRIVATE_CHAT, replyTo: PLAYER }),
  );

  expect(sentTexts).toEqual([]);
  expect(repo.calls).toEqual([]);
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
  expect(repo.calls.filter((call) => call === "recordCatchWithBalance")).toHaveLength(1);
  expect(repo.fishers.get("9:-100")!.balance).toBe(repo.catches[0]!.price);
  expect(sentTexts.at(-1)).toContain("<b>Имя:</b> Лещ");

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
