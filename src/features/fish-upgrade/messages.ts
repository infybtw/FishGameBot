import type { InventoryPage, UpgradeFishSource, UpgradedFishDraft } from "../../db/index.ts";
import { escapeHtml, round2 } from "../../lib/format.ts";
import { upgradeChanceSummary } from "./chances.ts";

export const FISH_UPGRADE_FOREIGN = "Это меню принадлежит другому игроку.";
export const FISH_UPGRADE_STALE = "Кнопка устарела. Откройте /fish_upgrade заново.";

export const FISH_UPGRADE_EMPTY =
  "🎣 <b>Улучшение рыбы</b>\nВ вашем инвентаре нет доступной рыбы.\nПоймайте рыбу через /fish и попробуйте снова.";

export const FISH_UPGRADE_UNAVAILABLE =
  "🎣 <b>Улучшение рыбы</b>\nЭта рыба больше недоступна — возможно, она уже продана, обменяна или улучшена.";

function money(value: number): string {
  return `${round2(value)} ₽`;
}

function fishTitle(fish: { name: string; rarity: string }): string {
  return `<b>${escapeHtml(fish.name)}</b> (${escapeHtml(fish.rarity)})`;
}

export function fishButtonLabel(fish: { id: number; name: string; rarity: string }): string {
  return `#${fish.id} ${fish.name} · ${fish.rarity}`;
}

export function upgradeMenuCard(inventory: InventoryPage): string {
  return [
    "🎣 <b>Улучшение рыбы</b>",
    "Выберите рыбу: при успехе вы получите случайную рыбу следующей редкости, при неудаче рыба расходуется.",
    `<b>Шанс успеха:</b> ${upgradeChanceSummary()}`,
    `<b>Доступно:</b> ${inventory.totalCount} шт. на ${money(inventory.totalValue)}`,
    `<b>Страница:</b> ${inventory.page}`,
  ].join("\n");
}

export function upgradeMaxRarityCard(source: UpgradeFishSource): string {
  return `🎣 <b>Улучшение рыбы</b>\nРыба #${source.id} ${fishTitle(source)} уже максимальной доступной редкости, улучшать некуда.`;
}

export function upgradeTargetMissingCard(source: UpgradeFishSource): string {
  return `🎣 <b>Улучшение рыбы</b>\nВ каталоге нет рыб следующей редкости, поэтому рыбу #${source.id} ${fishTitle(source)} улучшить нельзя.`;
}

export function upgradeConfirmCard(source: UpgradeFishSource, chance: number, targetRarity: string): string {
  return [
    "🎣 <b>Подтверждение улучшения</b>",
    `Рыба: #${source.id} ${fishTitle(source)}`,
    `Цель: ${escapeHtml(targetRarity)} (редкость ${source.point + 1})`,
    `<b>Шанс успеха: ${chance}%</b>`,
    "При неудаче рыба расходуется. Улучшить?",
  ].join("\n");
}

export function upgradeSuccessCard(source: UpgradeFishSource, chance: number, created: UpgradedFishDraft): string {
  return [
    "⬆️ <b>Улучшение удалось!</b>",
    `Была: #${source.id} ${fishTitle(source)}`,
    `Стала: ${fishTitle(created)} — ${round2(created.sizeCm)} см, ${round2(created.weightG)} г, ${money(created.price)}`,
    `Шанс был: ${chance}%`,
  ].join("\n");
}

export function upgradeFailureCard(source: UpgradeFishSource, chance: number): string {
  return [
    "💨 <b>Улучшение не удалось.</b>",
    `Рыба #${source.id} ${fishTitle(source)} расходована.`,
    `Шанс был: ${chance}%`,
  ].join("\n");
}

export const FISH_UPGRADE_SUCCESS_ANSWER = "⬆️ Улучшение удалось!";
export const FISH_UPGRADE_FAILURE_ANSWER = "Попытка не удалась.";
export const FISH_UPGRADE_UNAVAILABLE_ANSWER = "Эта рыба уже недоступна.";
export const FISH_UPGRADE_MAX_RARITY_ANSWER = "Эта рыба уже максимальной редкости.";
export const FISH_UPGRADE_TARGET_MISSING_ANSWER = "Следующей редкости нет в каталоге.";
