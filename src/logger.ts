export type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

const LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: "\x1b[90m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};

const RESET = "\x1b[0m";

function readLevel(raw: string | undefined): LogLevel {
  const value = raw?.trim().toLowerCase();
  if (value === "debug" || value === "info" || value === "warn" || value === "error") return value;
  if (value !== undefined && value !== "") {
    process.stderr.write(`[logger] Unknown LOG_LEVEL "${raw}", falling back to "info"\n`);
  }
  return "info";
}

const activeLevel = readLevel(process.env.LOG_LEVEL);
const colorize = process.stdout.isTTY === true;

function timestamp(): string {
  const d = new Date();
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

function formatError(err: Error): string {
  const stack =
    err.stack
      ?.split("\n")
      .slice(1)
      .map((line) => "    " + line.trim())
      .join("\n") ?? "";
  return `${err.name}: ${err.message}${stack ? `\n${stack}` : ""}`;
}

function formatField(value: unknown): string {
  if (value instanceof Error) return formatError(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? String(value);
}

function emit(level: LogLevel, fields: LogFields, msg: string): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[activeLevel]) return;
  const tag = colorize ? `${LEVEL_COLOR[level]}[${level}]${RESET}` : `[${level}]`;
  let line = `${timestamp()} ${tag} ${msg}`;
  for (const [key, value] of Object.entries(fields)) {
    line += `\n  ${key}: ${formatField(value)}`;
  }
  // Warnings and errors go to stderr, like loguru did; the rest to stdout.
  if (level === "warn" || level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

function makeLevelMethod(level: LogLevel) {
  return (arg1: LogFields | string, arg2?: string): void => {
    if (typeof arg1 === "string") {
      emit(level, {}, arg1);
    } else {
      emit(level, arg1, arg2 ?? "");
    }
  };
}

export const log = {
  debug: makeLevelMethod("debug"),
  info: makeLevelMethod("info"),
  warn: makeLevelMethod("warn"),
  error: makeLevelMethod("error"),
};
