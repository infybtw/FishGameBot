import type { BotCommand } from "grammy/types";
import type { Api } from "grammy";
import { log } from "../logger.ts";

const INFO_COMMAND: BotCommand = { command: "info", description: "Информация о боте" };

/** Commands that work for anyone inside group chats. */
const PUBLIC_GROUP_COMMANDS: BotCommand[] = [
  { command: "fish", description: "Забросить удочку и поймать рыбу" },
  { command: "net", description: "Забросить или собрать сеть" },
  { command: "profile", description: "Инвентарь, удочки и баланс" },
  { command: "fishes", description: "Каталог рыб чата" },
  { command: "fishtop", description: "Топ рыбаков чата" },
  { command: "stats", description: "Статистика рыбалки" },
  { command: "trade", description: "Предложить обмен рыбы или денег" },
  INFO_COMMAND,
];

/** Extra commands only the bot owner can run inside group chats. */
const OWNER_GROUP_COMMANDS: BotCommand[] = [
  ...PUBLIC_GROUP_COMMANDS,
  { command: "cd", description: "Активные кулдауны чата" },
  { command: "cdr", description: "Сбросить кулдаун (реплаем)" },
  { command: "cdr_all", description: "Сбросить все кулдауны чата" },
  { command: "cr", description: "Отменить последний улов (реплаем)" },
  { command: "chanceup", description: "Выдать буст шанса (реплаем)" },
  { command: "fakefish", description: "Тестовая карта улова" },
  { command: "cclear", description: "Удалить сообщения бота" },
];

/** Owner-only catalog maintenance commands, usable anywhere. */
const OWNER_PRIVATE_COMMANDS: BotCommand[] = [
  { command: "add_new_fish", description: "Добавить рыбу в каталог" },
  { command: "remove_fish", description: "Удалить рыбу из каталога" },
  { command: "import_fish", description: "Импорт каталога из JSON" },
  { command: "export_fish", description: "Экспорт каталога в JSON" },
  { command: "get_fish_list", description: "Показать каталог рыб" },
  { command: "reload_fish_list", description: "Перезагрузить каталог" },
  { command: "cancel", description: "Отменить активный диалог" },
  { command: "cclear", description: "Удалить сообщения бота" },
  INFO_COMMAND,
];

/**
 * Publishes command descriptions to Telegram so clients show the "/" menu.
 * Scope layout mirrors runtime permission checks: everyone in groups sees
 * public commands, the owner additionally sees admin commands per known
 * group chat, and the owner's private chat lists catalog maintenance.
 */
export async function syncCommandMenu(api: Api, adminUserId: number, groupChatIds: readonly number[]): Promise<void> {
  await api.setMyCommands(PUBLIC_GROUP_COMMANDS, { scope: { type: "all_group_chats" } });
  await api.setMyCommands([INFO_COMMAND], { scope: { type: "all_private_chats" } });
  await api.setMyCommands(OWNER_PRIVATE_COMMANDS, { scope: { type: "chat", chat_id: adminUserId } });

  let ownerMenus = 0;
  for (const chatId of groupChatIds) {
    try {
      await api.setMyCommands(OWNER_GROUP_COMMANDS, {
        scope: { type: "chat_member", chat_id: chatId, user_id: adminUserId },
      });
      ownerMenus += 1;
    } catch (err) {
      // The bot may have left this chat; the per-chat owner menu is optional.
      log.warn({ err, chatId }, "Owner command menu skipped for chat");
    }
  }
  log.info({ chats: groupChatIds.length, ownerMenus }, "Command menus updated");
}
