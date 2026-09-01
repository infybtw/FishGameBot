import type { Context } from "grammy";

export function isGroup(ctx: Context): boolean {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

export function isAdmin(ctx: Context, adminUserId: number): boolean {
  return ctx.from?.id === adminUserId;
}
