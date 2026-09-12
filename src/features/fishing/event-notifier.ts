import type { Api } from "grammy";
import type { Repo, TimeEventAnnouncement } from "../../db/index.ts";
import { log } from "../../logger.ts";
import { eventStartMessage } from "./messages.ts";
import { getActiveTimeEvent, type ActiveTimeEvent } from "./time-events.ts";

/** How often the notifier polls for a changed active event. */
export const TIME_EVENT_POLL_INTERVAL_MS = 60_000;

/** The occurrence identity stored after announcing, so restarts never re-announce. */
function occurrence(active: ActiveTimeEvent): TimeEventAnnouncement {
  return { eventId: active.event.id, startedAt: active.startsAt.getTime() / 1000 };
}

function sameOccurrence(a: TimeEventAnnouncement, b: TimeEventAnnouncement): boolean {
  return a.eventId === b.eventId && a.startedAt === b.startedAt;
}

/**
 * One announcement pass: when an event is active and its (id, start) pair has
 * never been announced, post one message to every known group chat and record
 * the pair. The pair lives in the database, so restarts and missed starts are
 * safe: only the not-yet-announced occurrence is sent, once. A failed send is
 * logged and the remaining chats still receive the announcement.
 */
export async function announceActiveTimeEvent(repo: Repo, api: Api, timeZone: string, now: Date): Promise<TimeEventAnnouncement | null> {
  const active = getActiveTimeEvent(now, timeZone);
  if (active === null) return null;
  const occurrence_ = occurrence(active);
  const announced = await repo.getTimeEventAnnouncement();
  if (announced !== null && sameOccurrence(announced, occurrence_)) return null;

  const chatIds = await repo.listChatIds();
  for (const chatId of chatIds) {
    try {
      await api.sendMessage(chatId, eventStartMessage(active, timeZone));
    } catch (err) {
      log.error({ err, chatId, eventId: active.event.id }, "Failed to announce time event");
      continue;
    }
    log.info({ chatId, eventId: active.event.id }, "Time event announced");
  }
  await repo.setTimeEventAnnouncement(occurrence_.eventId, occurrence_.startedAt);
  return occurrence_;
}

/**
 * Runs one pass immediately (catching up on events that started while the
 * process was down) and then once a minute. Passes never overlap in one bot
 * process; the returned cleanup stops future polls.
 */
export function startTimeEventNotifier(repo: Repo, api: Api, timeZone: string): () => void {
  let queue: Promise<void> = Promise.resolve();
  const tick = (): void => {
    queue = queue
      .then(async () => {
        await announceActiveTimeEvent(repo, api, timeZone, new Date());
      })
      .catch((err) => log.error({ err }, "Time event announcement pass failed"));
  };
  tick();
  const interval = setInterval(tick, TIME_EVENT_POLL_INTERVAL_MS);
  return () => clearInterval(interval);
}
