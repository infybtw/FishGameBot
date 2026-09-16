import { escapeHtml } from "../../lib/format.ts";
import {
  collectionBuffSummary,
  collectionEffectLabel,
  type CollectionBuffTotals,
  type CollectionDefinition,
  type CollectionProgress,
} from "./catalog.ts";

export const COLLECTIONS_FOREIGN = "Это меню принадлежит другому игроку.";
export const COLLECTIONS_STALE = "Кнопка устарела. Откройте /collections заново.";

export type CollectionMenuEntry = {
  collection: CollectionDefinition;
  progress: CollectionProgress;
  completed: boolean;
};

export function collectionButtonLabel(entry: CollectionMenuEntry): string {
  if (entry.completed) return `✅ ${entry.collection.name}`;
  if (!entry.progress.available) return `⚠️ ${entry.collection.name}`;
  return `${entry.progress.ready ? "🎁" : "◻️"} ${entry.collection.name} (${entry.progress.owned}/${entry.progress.total})`;
}

export function collectionsMenuCard(entries: readonly CollectionMenuEntry[], totals: CollectionBuffTotals): string {
  const completed = entries.filter((entry) => entry.completed).length;
  return [
    "🗂 <b>Коллекции</b>",
    "Сдавайте рыбу из инвентаря, чтобы завершать коллекции и получать постоянные бонусы.",
    `<b>Собрано:</b> ${completed}/${entries.length}`,
    `<b>Активные бонусы:</b> ${collectionBuffSummary(totals)}`,
    "",
    "Выберите коллекцию:",
  ].join("\n");
}

function requiredList(progress: CollectionProgress, availableByName: ReadonlyMap<string, number>): string {
  if (!progress.available) return "В текущем каталоге нет рыб для этой коллекции.";
  return progress.required
    .map((name) => {
      const count = availableByName.get(name) ?? 0;
      return count > 0 ? `✅ ${escapeHtml(name)} ×${count}` : `❌ ${escapeHtml(name)}`;
    })
    .join("\n");
}

export function collectionDetailCard(
  entry: CollectionMenuEntry,
  availableByName: ReadonlyMap<string, number>,
  notice?: string,
): string {
  const { collection, progress, completed } = entry;
  const lines = [
    `🗂 <b>${escapeHtml(collection.name)}</b>`,
    escapeHtml(collection.description),
    "",
    `<b>Награда:</b> ${collectionEffectLabel(collection.effect)}`,
  ];
  if (completed) {
    lines.push("<b>Статус:</b> ✅ Коллекция сдана, бонус активен.");
  } else if (!progress.available) {
    lines.push("<b>Статус:</b> ⚠️ Недоступна: в каталоге нет нужных рыб.");
  } else {
    lines.push(`<b>Прогресс:</b> ${progress.owned}/${progress.total}`);
  }
  lines.push("", requiredList(progress, availableByName));
  if (notice !== undefined) lines.push("", `⚠️ ${notice}`);
  return lines.join("\n");
}

export function collectionCompletedCard(collection: CollectionDefinition): string {
  return [
    `🏆 <b>Коллекция «${escapeHtml(collection.name)}» собрана!</b>`,
    `${escapeHtml(collection.description)}`,
    `<b>Постоянный бонус:</b> ${collectionEffectLabel(collection.effect)}`,
  ].join("\n");
}

export const COLLECTIONS_UNAVAILABLE_NOTICE = "В каталоге нет нужных рыб — сдать нельзя.";
export const COLLECTIONS_ALREADY_NOTICE = "Эта коллекция уже сдана.";
export const COLLECTIONS_DEPOSIT_COMPLETED_ANSWER = "🏆 Коллекция собрана!";
export const COLLECTIONS_DEPOSIT_MISSING_ANSWER = "Не хватает рыбы для сдачи.";
