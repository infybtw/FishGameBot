import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from "bun:test";
import type { Api } from "grammy";
import type { FishingNetRow, Repo } from "../../db/index.ts";
import { NET_DURATION_SECONDS } from "./net.ts";
import { notifyReadyFishingNets } from "./notifier.ts";

const NOW = 5_000_000;

type Send = { chatId: number; text: string };

function createRepo(rows: FishingNetRow[]): { repo: Repo; marks: string[] } {
  const marks: string[] = [];
  const key = (userId: number, chatId: number) => `${userId}:${chatId}`;
  const repo = {
    async listReadyUnnotifiedFishingNets(now: number) {
      return rows.filter((row) => row.castAt + NET_DURATION_SECONDS <= now && row.readyNotifiedAt === null);
    },
    async markFishingNetReadyNotified(userId: number, chatId: number, notifiedAt: number) {
      marks.push(key(userId, chatId));
      const row = rows.find((candidate) => candidate.userId === userId && candidate.chatId === chatId);
      if (row !== undefined) row.readyNotifiedAt = notifiedAt;
    },
  } as unknown as Repo;
  return { repo, marks };
}

function createApi(failingChatIds: ReadonlySet<number> = new Set()): { api: Api; sends: Send[] } {
  const sends: Send[] = [];
  const api = {
    async sendMessage(chatId: number, text: string) {
      sends.push({ chatId, text });
      if (failingChatIds.has(chatId)) throw new Error("Telegram is down");
      return true;
    },
  } as unknown as Api;
  return { api, sends };
}

function net(userId: number, chatId: number, firstName: string, castAt: number, readyNotifiedAt: number | null = null): FishingNetRow {
  return { userId, chatId, firstName, castAt, readyNotifiedAt };
}

beforeEach(() => {
  spyOn(Date, "now").mockReturnValue(NOW * 1000);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("notifyReadyFishingNets", () => {
  test("notifies the stored group of a due net and marks exactly that row", async () => {
    const rows = [
      net(1, -100, "Рано", NOW - 10), // not ready yet
      net(2, -200, "Готова", NOW - NET_DURATION_SECONDS), // due
      net(4, -300, "Уведомлён", NOW - NET_DURATION_SECONDS - 100, NOW - 50), // already notified
    ];
    const { repo, marks } = createRepo(rows);
    const { api, sends } = createApi();

    await notifyReadyFishingNets(repo, api);

    expect(sends).toEqual([
      { chatId: -200, text: `🪢 <a href="tg://user?id=2">Готова</a>, ваша сеть готова — заберите улов через /net.` },
    ]);
    expect(marks).toEqual(["2:-200"]);
    expect(rows[1]!.readyNotifiedAt).not.toBeNull();
    expect(rows[0]!.readyNotifiedAt).toBeNull();
    expect(rows[2]!.readyNotifiedAt).toBe(NOW - 50);
  });

  test("escapes the first name in the HTML mention", async () => {
    const { repo } = createRepo([net(2, -200, "<b>&Аня", NOW - NET_DURATION_SECONDS)]);
    const { api, sends } = createApi();

    await notifyReadyFishingNets(repo, api);

    expect(sends[0]!.text).toContain(`🪢 <a href="tg://user?id=2">&lt;b&gt;&amp;Аня</a>, ваша сеть готова`);
  });

  test("a failed send leaves the net unnotified so the next pass retries", async () => {
    const rows = [net(2, -200, "Готова", NOW - NET_DURATION_SECONDS)];
    const { repo, marks } = createRepo(rows);
    const failing = createApi(new Set([-200]));

    await notifyReadyFishingNets(repo, failing.api);

    expect(failing.sends).toHaveLength(1);
    expect(marks).toEqual([]);
    expect(rows[0]!.readyNotifiedAt).toBeNull();

    const working = createApi();
    await notifyReadyFishingNets(repo, working.api);
    expect(working.sends).toHaveLength(1);
    expect(marks).toEqual(["2:-200"]);
    expect(rows[0]!.readyNotifiedAt).not.toBeNull();
  });

  test("does nothing when no net is due", async () => {
    const { repo, marks } = createRepo([net(1, -100, "Рано", NOW - 10)]);
    const { api, sends } = createApi();

    await notifyReadyFishingNets(repo, api);

    expect(sends).toEqual([]);
    expect(marks).toEqual([]);
  });
});
