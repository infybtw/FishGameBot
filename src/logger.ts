export type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

const LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function readLevel(raw: string | undefined): LogLevel {
  const value = raw?.trim().toLowerCase();
  if (value === "debug" || value === "info" || value === "warn" || value === "error") return value;
  if (value !== undefined && value !== "") {
    process.stderr.write(`{"level":"warn","msg":${JSON.stringify(`Unknown LOG_LEVEL "${raw}", falling back to "info"`)}}\n`);
  }
  return "info";
}

const activeLevel = readLevel(process.env.LOG_LEVEL);

function serializeFields(fields: LogFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    // Error instances stringify to {} by default; surface name/message/stack.
    out[key] = value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value;
  }
  return out;
}

function emit(level: LogLevel, fields: LogFields, msg: string): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[activeLevel]) return;
  const line = JSON.stringify({ ...serializeFields(fields), level, time: new Date().toISOString(), msg });
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
