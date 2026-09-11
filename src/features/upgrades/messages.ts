import type { InventoryPage, RarityInventorySummary } from "../../db/index.ts";
import { escapeHtml, round2 } from "../../lib/format.ts";
import { modifierLabel } from "../fishing/modifiers.ts";
import { getRod, type RodDefinition } from "./rods.ts";

export function money(value: number): string {
  return `${round2(value)} ₽`;
}

export function rarityLabel(point: number): string {
  const labels = ["Обычная", "Редкая", "Эпическая", "Легендарная", "Мифическая", "Радужная"];
  return labels[point - 1] ?? `Редкость #${point}`;
}

export function profileCard(
  balance: number,
  rod: RodDefinition,
  baseCatchChance: number,
  availableCount: number,
  availableValue: number,
): string {
  const effectiveCatchChance = Math.min(100, baseCatchChance + rod.catchBonusPoints);
  return (
    `🐟 <b>Профиль рыбака</b>\n\n` +
    `<b>Баланс:</b> ${money(balance)}\n` +
    `<b>Удочка:</b> ${escapeHtml(rod.name)}\n` +
    `<b>Шанс поймать:</b> ${baseCatchChance}% → ${effectiveCatchChance}%\n` +
    `<b>Бонус редкости:</b> +${round2(rod.rarityStepBonus * 100)}% за шаг\n` +
    `<b>В инвентаре:</b> ${availableCount} шт. на ${money(availableValue)}`
  );
}

export function inventoryCard(inventory: InventoryPage): string {
  const lines = [
    "🎒 <b>Инвентарь</b>",
    `<b>Доступно:</b> ${inventory.totalCount} шт. на ${money(inventory.totalValue)}`,
    `<b>Страница:</b> ${inventory.page}`,
  ];
  if (inventory.fishes.length === 0) lines.push("\nИнвентарь пуст.");
  for (const fish of inventory.fishes) {
    lines.push(
      `\n#${fish.id} <b>${escapeHtml(modifierLabel(fish.name, fish.fishModifierName))}</b>`,
      `${escapeHtml(fish.rarity)} · ${round2(fish.weightG / 1000)} кг · ${round2(fish.sizeCm)} см`,
      `Цена продажи: ${money(fish.price)}`,
    );
  }
  return lines.join("\n");
}

export function raritySaleCard(summaries: readonly RarityInventorySummary[]): string {
  const lines = ["💰 <b>Продать по редкости</b>", "Выберите категорию для продажи:"];
  if (summaries.length === 0) lines.push("\nНет доступной рыбы.");
  for (const summary of summaries) {
    lines.push(`${rarityLabel(summary.point)}: ${summary.count} шт. · ${money(summary.total)}`);
  }
  return lines.join("\n");
}

export function raritySaleConfirmation(point: number, count: number, total: number): string {
  return (
    `💰 <b>Подтвердить продажу</b>\n\n` +
    `${rarityLabel(point)}: ${count} шт.\n` +
    `Сумма: <b>${money(total)}</b>\n\n` +
    `Рыба, пойманная после открытия этого экрана, не будет продана.`
  );
}

export function rodsCard(rods: readonly { rod: RodDefinition; state: string }[]): string {
  return ["🎣 <b>Удочки</b>", "", ...rods.map(({ rod, state }) => `${escapeHtml(rod.name)} — <b>${state}</b>`)].join("\n");
}

export function rodDetailCard(
  rod: RodDefinition,
  state: string,
  balance: number,
  inventory: readonly RarityInventorySummary[],
  unavailablePoints: ReadonlySet<number>,
): string {
  const byPoint = new Map(inventory.map((summary) => [summary.point, summary]));
  const prerequisite = rod.prerequisite === null ? "нет" : escapeHtml(getRod(rod.prerequisite)!.name);
  const recipe =
    rod.recipe.length === 0
      ? "нет"
      : rod.recipe
          .map((item) => {
            if (unavailablePoints.has(item.point)) return `${rarityLabel(item.point)} — недоступна в текущем каталоге`;
            const available = byPoint.get(item.point)?.count ?? 0;
            return `${rarityLabel(item.point)}: ${available}/${item.count}`;
          })
          .join("\n");
  return (
    `🎣 <b>${escapeHtml(rod.name)}</b>\n\n` +
    `<b>Статус:</b> ${state}\n` +
    `<b>Предыдущая удочка:</b> ${prerequisite}\n` +
    `<b>Стоимость:</b> ${money(rod.price)}\n` +
    `<b>Рецепт:</b>\n${recipe}\n` +
    `<b>Бонус к поимке:</b> +${rod.catchBonusPoints} п.п.\n` +
    `<b>Бонус редкости:</b> +${round2(rod.rarityStepBonus * 100)}% × (редкость − 1)\n\n` +
    `<b>Ваш баланс:</b> ${money(balance)}`
  );
}
