export const COMMAND_OUTPUT_SETTINGS = [
  { command: "fish", label: "Рыбалка" },
  { command: "net", label: "Сеть" },
  { command: "event", label: "Событие" },
  { command: "events", label: "Расписание событий" },
  { command: "fishes", label: "Каталог рыб" },
  { command: "fishtop", label: "Топ рыбаков" },
  { command: "fish_upgrade", label: "Улучшение рыбы" },
  { command: "info", label: "Информация" },
  { command: "changelog", label: "Обновления" },
] as const;

export type CommandOutputSetting = (typeof COMMAND_OUTPUT_SETTINGS)[number]["command"];

const FIXED_COMMAND_OUTPUT_MODES = {
  profile: "personal",
  stats: "normal",
  trade: "normal",
} as const;

export function isCommandOutputSetting(command: string): command is CommandOutputSetting {
  return COMMAND_OUTPUT_SETTINGS.some((entry) => entry.command === command);
}

export function fixedCommandOutputMode(command: string): "normal" | "personal" | undefined {
  return FIXED_COMMAND_OUTPUT_MODES[command as keyof typeof FIXED_COMMAND_OUTPUT_MODES];
}
