import type { InventoryPage, TradeRow } from "../../db/index.ts";
import { escapeHtml, round2 } from "../../lib/format.ts";

export const TRADE_USAGE = "Команду /trade нужно отправить ответом на сообщение другого игрока.";

export function money(value: number): string {
  return `${round2(value)} ₽`;
}

export function playerLink(userId: number, firstName: string): string {
  return `<a href="tg://user?id=${userId}">${escapeHtml(firstName)}</a>`;
}

export function tradeMenu(targetUserId: number, targetFirstName: string): string {
  return (
    `🎣 <b>Обмен</b>\n` +
    `Вы предлагаете обмен игроку ${playerLink(targetUserId, targetFirstName)}.\n` +
    `Выберите, чем готовы заплатить:`
  );
}

export function initiatorFishCard(inventory: InventoryPage): string {
  const lines = [
    "🎣 <b>Обмен рыбой</b>",
    "Выберите рыбу, которую отдадите:",
    `<b>Доступно:</b> ${inventory.totalCount} шт. на ${money(inventory.totalValue)}`,
    `<b>Страница:</b> ${inventory.page}`,
  ];
  for (const fish of inventory.fishes) {
    lines.push(`\n#${fish.id} <b>${escapeHtml(fish.name)}</b> — ${money(fish.price)}`);
  }
  return lines.join("\n");
}

export function targetFishCard(targetUserId: number, targetFirstName: string, inventory: InventoryPage): string {
  const lines = [
    `🎣 <b>Обмен рыбой</b>`,
    `Выберите рыбу, которую хотите получить у игрока ${playerLink(targetUserId, targetFirstName)}:`,
    `<b>Доступно:</b> ${inventory.totalCount} шт. на ${money(inventory.totalValue)}`,
    `<b>Страница:</b> ${inventory.page}`,
  ];
  for (const fish of inventory.fishes) {
    lines.push(`\n#${fish.id} <b>${escapeHtml(fish.name)}</b> — ${money(fish.price)}`);
  }
  return lines.join("\n");
}

export const INITIATOR_FISH_EMPTY =
  "🎣 <b>Обмен рыбой</b>\nВ вашем инвентаре нет доступной рыбы для обмена.\nПоймайте рыбу через /fish и попробуйте снова.";
export function targetFishEmpty(targetUserId: number, targetFirstName: string): string {
  return (
    "🎣 <b>Обмен рыбой</b>\n" +
    `У игрока ${playerLink(targetUserId, targetFirstName)} нет доступной рыбы для обмена.`
  );
}

export const MONEY_PROMPT_PREFIX = "Введите сумму в рублях, которую предложите игроку";
export const MONEY_INVALID =
  "Не удалось разобрать сумму. Введите положительное число не более чем с двумя знаками после запятой, например 150 или 99.99.";

export function tradeOfferCard(trade: TradeRow): string {
  const offered =
    trade.offer.kind === "money"
      ? `<b>${money(trade.offer.amount)}</b>`
      : `рыбу <b>${escapeHtml(trade.offer.fish.name)}</b> (${escapeHtml(trade.offer.fish.rarity)}) — ${money(trade.offer.fish.price)}`;
  const requested =
    trade.requestedFish === null
      ? "неизвестную рыбу"
      : `рыбу <b>${escapeHtml(trade.requestedFish.name)}</b> (${escapeHtml(trade.requestedFish.rarity)}) — ${money(trade.requestedFish.price)}`;
  return (
    `🤝 <b>Предложение обмена</b>\n\n` +
    `${playerLink(trade.initiatorUserId, trade.initiatorFirstName)} предлагает ${offered},\n` +
    `и просит у ${playerLink(trade.targetUserId, trade.targetFirstName)} ${requested}.\n\n` +
    `Только адресат может принять или отклонить обмен.`
  );
}

export const TRADE_DONE = "🤝 Обмен завершён";
export const TRADE_DECLINED = "🤝 Обмен отклонён";
export const TRADE_UNAVAILABLE = "🤝 Обмен недоступен";
