import type { Config } from "../../config.ts";
import type { Repo } from "../../db/index.ts";

export type CooldownCheck = { ok: true } | { ok: false; secondsLeft: number };

/**
 * Seconds until the cooldown started at `lastCatchTime` expires at `now`;
 * negative once the delay has fully elapsed, zero exactly at the boundary.
 */
export function cooldownSecondsLeft(lastCatchTime: number, delaySeconds: number, now: number): number {
  return lastCatchTime + delaySeconds - now;
}

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
  const secondsLeft = cooldownSecondsLeft(last, cfg.catchDelaySeconds, now);
  if (secondsLeft < 0) {
    await repo.upsertCatchTime(userId, chatId, now);
    return { ok: true };
  }
  return { ok: false, secondsLeft };
}

export function formatRemaining(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds / 60) - h * 60;
  const s = Math.floor(seconds % 60);
  return `${h}часов ${m}минут ${s}секунд`;
}
