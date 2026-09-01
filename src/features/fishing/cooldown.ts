import type { Config } from "../../config.ts";
import type { Repo } from "../../db/index.ts";

export type CooldownCheck = { ok: true } | { ok: false; secondsLeft: number };

/**
 * Cooldown starts on every allowed attempt, whether or not a fish is caught.
 */
export async function checkCooldown(
  repo: Repo,
  cfg: Config,
  userId: number,
  chatId: number,
): Promise<CooldownCheck> {
  const now = Date.now() / 1000;
  const last = await repo.getCatchTime(userId, chatId);
  if (last === null) {
    await repo.upsertCatchTime(userId, chatId, now);
    return { ok: true };
  }
  const remaining = now - last - cfg.catchDelaySeconds;
  if (remaining > 0) {
    await repo.upsertCatchTime(userId, chatId, now);
    return { ok: true };
  }
  return { ok: false, secondsLeft: -remaining };
}

export function formatRemaining(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds / 60) - h * 60;
  const s = Math.floor(seconds % 60);
  return `${h}часов ${m}минут ${s}секунд`;
}
