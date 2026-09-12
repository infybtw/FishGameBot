import { afterEach, describe, expect, jest, spyOn, test } from "bun:test";
import type { Api } from "grammy";
import type { Repo, TimeEventAnnouncement } from "../../db/index.ts";
import { announceActiveTimeEvent } from "./event-notifier.ts";

const TZ = "Europe/Moscow";

/** UTC instant of the given Moscow wall-clock time (MSK is UTC+3 all year). */
function msk(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 3, minute));
}

function createRepo(chats: number[]): { repo: Repo; setAnnouncement: (a: TimeEventAnnouncement | null) => void; getAnnouncement: () => TimeEventAnnouncement | null } {
  let stored: TimeEventAnnouncement | null = null;
  const repo = {
    async listChatIds() {
      return chats;
    },
    async getTimeEventAnnouncement() {
      return stored;
    },
    async setTimeEventAnnouncement(eventId: string, startedAt: number) {
      stored = { eventId, startedAt };
    },
  } as unknown as Repo;
  return {
    repo,
    setAnnouncement: (value) => {
      stored = value;
    },
    getAnnouncement: () => stored,
  };
}

function createApi(failingChatIds: ReadonlySet<number> = new Set()): { api: Api; sends: Array<{ chatId: number; text: string }> } {
  const sends: Array<{ chatId: number; text: string }> = [];
  const api = {
    async sendMessage(chatId: number, text: string) {
      if (failingChatIds.has(chatId)) throw new Error("Telegram is down");
      sends.push({ chatId, text });
      return true;
    },
  } as unknown as Api;
  return { api, sends };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("announceActiveTimeEvent", () => {
  test("announces a starting event once to every known chat and stores the occurrence", async () => {
    const { repo, getAnnouncement } = createRepo([-100, -200]);
    const { api, sends } = createApi();

    const stored = await announceActiveTimeEvent(repo, api, TZ, msk(2026, 9, 12, 0, 30));

    expect(sends).toHaveLength(2);
    expect(sends[0]).toMatchObject({ chatId: -100 });
    expect(sends[1]).toMatchObject({ chatId: -200 });
    expect(sends[0]!.text).toContain("Лунная заводь");
    expect(sends[0]!.text).toContain("до 02:00");
    expect(getAnnouncement()).toEqual({ eventId: "moon_pool", startedAt: Date.UTC(2026, 8, 11, 21, 0) / 1000 });
    expect(stored).toEqual(getAnnouncement());
  });

  test("a second check inside the same occurrence sends nothing", async () => {
    const { repo, getAnnouncement } = createRepo([-100]);
    const { api, sends } = createApi();

    await announceActiveTimeEvent(repo, api, TZ, msk(2026, 9, 12, 0, 30));
    expect(await announceActiveTimeEvent(repo, api, TZ, msk(2026, 9, 12, 1, 59))).toBeNull();

    expect(sends).toHaveLength(1);
    expect(getAnnouncement()).toEqual({ eventId: "moon_pool", startedAt: Date.UTC(2026, 8, 11, 21, 0) / 1000 });
  });

  test("a restart replays no announcement for the already announced occurrence", async () => {
    const { repo, getAnnouncement, setAnnouncement } = createRepo([-100]);
    setAnnouncement({ eventId: "moon_pool", startedAt: Date.UTC(2026, 8, 11, 21, 0) / 1000 });
    const { api, sends } = createApi();

    // Fresh process, same repo: the pair already matches, so nothing is sent.
    expect(await announceActiveTimeEvent(repo, api, TZ, msk(2026, 9, 12, 1, 0))).toBeNull();

    expect(sends).toHaveLength(0);
    expect(getAnnouncement()).toEqual({ eventId: "moon_pool", startedAt: Date.UTC(2026, 8, 11, 21, 0) / 1000 });
  });

  test("an event that started while the process was down is announced exactly once", async () => {
    const { repo, getAnnouncement, setAnnouncement } = createRepo([-100]);
    // Wednesday's calm was the last announced occurrence.
    setAnnouncement({ eventId: "calm", startedAt: Date.UTC(2026, 8, 9, 12, 0) / 1000 });
    const { api, sends } = createApi();

    // The bot was down at 22:00; on restart at 22:30 the missed start is announced.
    await announceActiveTimeEvent(repo, api, TZ, msk(2026, 9, 9, 22, 30));

    expect(sends).toHaveLength(1);
    expect(sends[0]!.text).toContain("Ночной трофей");
    expect(getAnnouncement()).toEqual({ eventId: "night_trophy", startedAt: Date.UTC(2026, 8, 9, 19, 0) / 1000 });
  });

  test("a failing chat is logged and skipped while the rest still receive the announcement", async () => {
    const { repo, getAnnouncement } = createRepo([-100, -200, -300]);
    const { api, sends } = createApi(new Set([-200]));

    await announceActiveTimeEvent(repo, api, TZ, msk(2026, 9, 12, 0, 30));

    expect(sends.map((send) => send.chatId)).toEqual([-100, -300]);
    expect(getAnnouncement()).toEqual({ eventId: "moon_pool", startedAt: Date.UTC(2026, 8, 11, 21, 0) / 1000 });

    // The recorded pair prevents duplicate retries on the next pass.
    const retry = createApi();
    expect(await announceActiveTimeEvent(repo, retry.api, TZ, msk(2026, 9, 12, 0, 45))).toBeNull();
    expect(retry.sends).toHaveLength(0);
  });

  test("does nothing when no event is active", async () => {
    const { repo, getAnnouncement } = createRepo([-100]);
    const { api, sends } = createApi();

    expect(await announceActiveTimeEvent(repo, api, TZ, msk(2026, 9, 9, 10, 0))).toBeNull();

    expect(sends).toHaveLength(0);
    expect(getAnnouncement()).toBeNull();
  });

  test("re-announces the same event on its next occurrence the following day", async () => {
    const { repo, getAnnouncement } = createRepo([-100]);
    const { api, sends } = createApi();

    await announceActiveTimeEvent(repo, api, TZ, msk(2026, 9, 9, 15, 30));
    expect(sends).toHaveLength(1);
    const firstStored = getAnnouncement();

    await announceActiveTimeEvent(repo, api, TZ, msk(2026, 9, 10, 15, 30));
    expect(sends).toHaveLength(2);
    expect(getAnnouncement()).not.toEqual(firstStored);
  });
});
