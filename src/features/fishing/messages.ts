import type { TopFisherRow } from "../../db/index.ts";
import { escapeHtml, round2 } from "../../lib/format.ts";
import { formatRemaining } from "./cooldown.ts";
import type { CaughtFish } from "./generator.ts";

export function catchCard(fish: CaughtFish): string {
  return (
    `${escapeHtml(fish.catcherFirstName)}\n` +
    `🌟 Удача! Вы смогли вытянуть Рыбу🌟\n` +
    `<b>Имя:</b> ${escapeHtml(fish.name)} \n` +
    `<b>Редкость:</b> ${escapeHtml(fish.rarity)}\n` +
    `<b>Вес:</b> ${round2(fish.weightG / 1000)}кг\n` +
    `<b>Размер:</b> ${fish.sizeCm}см\n` +
    `\n` +
    `<b>Цена:</b> ${round2(fish.price)}рублей`
  );
}

export function nothingCaught(firstName: string): string {
  return `${escapeHtml(firstName)}\n😫Упс похоже ты ничего не поймал😫`;
}

export function cooldownMsg(firstName: string, secondsLeft: number): string {
  return (
    `${escapeHtml(firstName)}\n` +
    `Вы недавно ловили рыбу\n` +
    `До следующего улова осталось:\n` +
    `<b>${formatRemaining(secondsLeft)}</b>`
  );
}

export function topFishers(rows: TopFisherRow[]): string {
  if (rows.length === 0) return "Топ рыбаков пока пустует";
  return (
    `🐟Топ рыбаков:🐟\n` +
    rows.map((row, i) => `${i + 1}| ${escapeHtml(row.firstName)} - ${round2(row.total)}руб\n`).join("")
  );
}

const RARITY_LABELS = ["Обычных", "Редких", "Эпических", "Легендарных", "Мифических", "Радужных"];

export function statsMsg(
  userId: number,
  firstName: string,
  totalPrice: number,
  balance: number,
  count: number,
  rarityCounts: number[],
): string {
  let text =
    `🐋<b>Ваша статистика</b>🐋\n\n` +
    `<b>UserID:</b> ${userId}\n` +
    `<b>UserName:</b> ${escapeHtml(firstName)}\n` +
    `<b>Суммарная стоимость рыб:</b> ${round2(totalPrice)}р\n` +
    `<b>Баланс:</b> ${round2(balance)}р\n` +
    `<b>Поймано рыб:</b> ${count}\n\n`;
  for (let point = 1; point <= RARITY_LABELS.length; point++) {
    text += `<b>${RARITY_LABELS[point - 1]}</b> - ${rarityCounts[point - 1] ?? 0}\n`;
  }
  return text;
}

export function statsEmpty(firstName: string): string {
  return `${escapeHtml(firstName)}\nВаша статистика пока пуста`;
}
