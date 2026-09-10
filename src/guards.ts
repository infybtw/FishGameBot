import type { Context } from "grammy";

export function isGroup(ctx: Context): boolean {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

/** Command-reply target: a non-bot Telegram user, or null when absent or ineligible. */
export function replyTarget(ctx: Context): { id: number; firstName: string } | null {
  const from = ctx.message?.reply_to_message?.from;
  return from === undefined || from.is_bot ? null : { id: from.id, firstName: from.first_name };
}

export function isAdmin(ctx: Context, adminUserId: number): boolean {
  return ctx.from?.id === adminUserId;
}
