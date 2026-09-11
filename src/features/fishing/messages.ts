import type { DeletedCatch, TopFisherRow } from "../../db/index.ts";
import { escapeHtml, round2 } from "../../lib/format.ts";
import { formatRemaining } from "./cooldown.ts";
import { CURSES } from "./curses.ts";
import type { CaughtFish } from "./generator.ts";
import { RARITY_WEIGHTS, type Catalog } from "./catalog.ts";
import { FISH_MODIFIERS } from "./modifiers.ts";

export function catchCard(fish: CaughtFish): string {
  const modifierLine =
    fish.modifier === null ? "" : `<b>Модификатор:</b> ${escapeHtml(fish.modifier.name)} (${escapeHtml(fish.modifier.rarity)})\n`;
  return (
    `${escapeHtml(fish.catcherFirstName)}\n` +
    `🌟 Удача! Вы смогли вытянуть Рыбу🌟\n` +
    `<b>Имя:</b> ${escapeHtml(fish.name)} \n` +
    `<b>Редкость:</b> ${escapeHtml(fish.rarity)}\n` +
    modifierLine +
    `<b>Вес:</b> ${round2(fish.weightG / 1000)}кг\n` +
    `<b>Размер:</b> ${fish.sizeCm}см\n` +
    `\n` +
    `<b>Цена:</b> ${round2(fish.price)}рублей\n` +
    `Рыба добавлена в инвентарь. Продайте её через /profile.`
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

export function cooldownReset(firstName: string): string {
  return `Кулдаун для ${escapeHtml(firstName)} снят`;
}

export function cooldownsResetAll(count: number): string {
  return `Кулдауны сняты для всех (${count})`;
}

export function heavyNetCurse(catchDelaySeconds: number): string {
  return `🪢 <b>${CURSES.heavy_net.name}</b>\nКулдаун увеличен до ${formatRemaining(catchDelaySeconds * 2)}.`;
}

export function secondCastCurse(): string {
  return `🌀 <b>${CURSES.second_cast.name}</b>\nВаш кулдаун снят: можно ловить снова.`;
}

export function goldenScalesCurse(multiplier: number): string {
  return `🪙 <b>${CURSES.golden_scales.name}</b>\nВаш баланс умножен на ×${round2(multiplier)}.`;
}

export const CDR_USAGE = "Ответьте на сообщение пользователя командой /cdr";
export const CHANCE_UP_USAGE = "Ответьте на сообщение пользователя командой /chanceup";
export const FAKE_FISH_CATALOG_EMPTY = "В списке нет рыб редкости 5 или 6";
export const CHANCE_UP_CATALOG_EMPTY = "В списке нет рыб редкости 2–6";
export const COOLDOWNS_EMPTY = "Кулдауны пока отсутствуют";

export function cooldownList(rows: Array<{ firstName: string; minutesLeft: number }>): string {
  if (rows.length === 0) return COOLDOWNS_EMPTY;
  return (
    `🐟 <b>Кулдауны</b>\n` +
    rows.map((row) => `• <b>${escapeHtml(row.firstName)}</b> — ${row.minutesLeft} мин.`).join("\n")
  );
}

export function chanceUpGranted(firstName: string): string {
  return `Шанс для ${escapeHtml(firstName)} повышен: следующая разрешённая /fish гарантированно поймает рыбу редкости 2–6.`;
}

export const CR_USAGE = "Ответьте на сообщение пользователя командой /cr";

export function lastCatchRemoved(firstName: string, fish: DeletedCatch): string {
  return `Последний улов для ${escapeHtml(firstName)} удалён администратором из инвентаря: ${escapeHtml(fish.fishName)} (${escapeHtml(fish.rarity)})`;
}

export function lastCatchMissing(firstName: string): string {
  return `У ${escapeHtml(firstName)} нет пойманных рыб`;
}

export function topFishers(rows: TopFisherRow[]): string {
  if (rows.length === 0) return "Топ рыбаков пока пустует";
  return (
    `🐟Топ рыбаков:🐟\n` +
    rows.map((row, i) => `${i + 1}| ${escapeHtml(row.firstName)} - ${round2(row.total)}руб\n`).join("")
  );
}

export function fishCatalogMessage(catalog: Catalog, modifierDropChance: number): string {
  const groups: Array<{ fishes: NonNullable<Catalog[number]>; weight: number }> = [];
  let totalWeight = 0;
  for (let point = 1; point <= catalog.length; point++) {
    const fishes = catalog[point - 1];
    if (fishes === undefined || fishes.length === 0) continue;
    const weight = RARITY_WEIGHTS[point] ?? 0;
    groups.push({ fishes, weight });
    totalWeight += weight;
  }
  if (groups.length === 0) return "Список рыб пока пуст";

  const rows = groups.flatMap(({ fishes, weight }) => {
    const chance = totalWeight === 0 ? 0 : round2((weight * 100) / totalWeight / fishes.length);
    return fishes.map(
      (fish) => `• <b>${escapeHtml(fish.name)}</b> — ${escapeHtml(fish.rarity)} — ${chance}%`,
    );
  });
  const modifierRows = FISH_MODIFIERS.map(
    (modifier) =>
      `• <b>${escapeHtml(modifier.name)}</b> — ${escapeHtml(modifier.rarity)} — ${round2(modifier.weight)}% — ` +
      `размер ×${round2(modifier.sizeMultiplier)} · цена ×${round2(modifier.priceMultiplier)}`,
  );
  return (
    `🐟 <b>Список рыб</b>\n` +
    `<i>Шанс указан среди успешных уловов.</i>\n\n` +
    `${rows.join("\n")}\n\n` +
    `✨ <b>Модификаторы</b> — ${round2(modifierDropChance)}% уловов\n` +
    `<i>Шанс указан среди модифицированных рыб.</i>\n\n` +
    modifierRows.join("\n")
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
