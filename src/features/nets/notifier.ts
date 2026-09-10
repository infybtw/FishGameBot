import type { Api } from "grammy";
import type { FishingNetRow, Repo } from "../../db/index.ts";
import { escapeHtml } from "../../lib/format.ts";
import { log } from "../../logger.ts";
import { NET_READY_POLL_INTERVAL_MS } from "./net.ts";

export function readyMessage(row: FishingNetRow): string {
  return `🪢 <a href="tg://user?id=${row.userId}">${escapeHtml(row.firstName)}</a>, ваша сеть готова — заберите улов через /net.`;
}

/**
 * One serialized pass over the nets that became ready without a recorded
 * notification. Delivery is confirmed before the row is marked; a failed send
 * stays eligible so the next pass retries. Collection never depends on this.
 */
export async function notifyReadyFishingNets(repo: Repo, api: Api): Promise<void> {
  const rows = await repo.listReadyUnnotifiedFishingNets(Date.now() / 1000);
  for (const row of rows) {
    try {
      await api.sendMessage(row.chatId, readyMessage(row));
    } catch (err) {
      log.error({ err, userId: row.userId, chatId: row.chatId }, "Failed to send fishing net readiness notification");
      continue;
    }
    await repo.markFishingNetReadyNotified(row.userId, row.chatId, Date.now() / 1000);
    log.info({ userId: row.userId, chatId: row.chatId }, "Fishing net readiness notified");
  }
}

/**
 * Runs one pass immediately (catching up on nets that ripened while the
 * process was down) and then on a fixed interval. Passes never overlap in one
 * bot process; the returned cleanup stops future polls.
 */
export function startNetNotifier(repo: Repo, api: Api): () => void {
  let queue: Promise<void> = Promise.resolve();
  const tick = (): void => {
    queue = queue
      .then(() => notifyReadyFishingNets(repo, api))
      .catch((err) => log.error({ err }, "Fishing net notification pass failed"));
  };
  tick();
  const interval = setInterval(tick, NET_READY_POLL_INTERVAL_MS);
  return () => clearInterval(interval);
}
