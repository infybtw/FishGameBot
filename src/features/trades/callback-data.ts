/**
 * Callback wire format for player trades.
 *
 * Builder menus are ephemeral and owner-bound: every payload carries the
 * initiator (owner), the replied-to player (target), and the flow context,
 * all encoded in base 36 to stay within Telegram's 64-byte callback_data
 * limit. Public accept/decline payloads carry the persisted trade ID only;
 * authorization for those happens against the stored row.
 */
export type TradeMenuAction =
  | { kind: "menu" }
  | { kind: "initiatorFish"; page: number }
  | { kind: "pickInitiatorFish"; fishId: number }
  | { kind: "targetFish"; offeredFishId: number; page: number }
  | { kind: "pickTargetFish"; offeredFishId: number; fishId: number }
  | { kind: "targetFishMoney"; page: number }
  | { kind: "pickTargetFishMoney"; fishId: number };

export type ParsedTradeMenuData = { ownerUserId: number; targetUserId: number; action: TradeMenuAction };

export type PublicTradeAction = { kind: "accept" } | { kind: "decline" };
export type ParsedPublicTradeData = { tradeId: number; action: PublicTradeAction };

const MENU_PREFIX = "tr:";
const PUBLIC_PREFIX = "trd:";

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/** Encodes a positive safe integer as base 36. */
function encodeId(value: number): string {
  if (!isPositiveSafeInteger(value)) throw new Error("Callback fields must be positive safe integers");
  return value.toString(36);
}

function decodeId(value: string | undefined): number | null {
  if (value === undefined || !/^[0-9a-z]+$/.test(value)) return null;
  const parsed = parseInt(value, 36);
  return isPositiveSafeInteger(parsed) ? parsed : null;
}

function assertPayload(payload: string): string {
  if (Buffer.byteLength(payload, "utf8") > 64) throw new Error("Telegram callback_data exceeds 64 bytes");
  return payload;
}

export function buildMenuCallbackData(ownerUserId: number, targetUserId: number, action: TradeMenuAction): string {
  const prefix = assertPayload(`${MENU_PREFIX}${encodeId(ownerUserId)}:${encodeId(targetUserId)}`);
  switch (action.kind) {
    case "menu":
      return assertPayload(`${prefix}:menu`);
    case "initiatorFish":
      return assertPayload(`${prefix}:if:${encodeId(action.page)}`);
    case "pickInitiatorFish":
      return assertPayload(`${prefix}:pif:${encodeId(action.fishId)}`);
    case "targetFish":
      return assertPayload(`${prefix}:tf:${encodeId(action.offeredFishId)}:${encodeId(action.page)}`);
    case "pickTargetFish":
      return assertPayload(`${prefix}:ptf:${encodeId(action.offeredFishId)}:${encodeId(action.fishId)}`);
    case "targetFishMoney":
      return assertPayload(`${prefix}:tfm:${encodeId(action.page)}`);
    case "pickTargetFishMoney":
      return assertPayload(`${prefix}:ptfm:${encodeId(action.fishId)}`);
  }
}

export function buildPublicCallbackData(tradeId: number, action: PublicTradeAction): string {
  const verb = action.kind === "accept" ? "a" : "d";
  return assertPayload(`${PUBLIC_PREFIX}${encodeId(tradeId)}:${verb}`);
}

const MENU_PATTERN = new RegExp(
  `^${MENU_PREFIX}([0-9a-z]+):([0-9a-z]+):(menu` +
    `|if:([0-9a-z]+)` +
    `|pif:([0-9a-z]+)` +
    `|tf:([0-9a-z]+):([0-9a-z]+)` +
    `|ptf:([0-9a-z]+):([0-9a-z]+)` +
    `|tfm:([0-9a-z]+)` +
    `|ptfm:([0-9a-z]+))$`,
);

export function parseMenuCallbackData(payload: string): ParsedTradeMenuData | null {
  const match = MENU_PATTERN.exec(payload);
  if (match === null) return null;
  const ownerUserId = decodeId(match[1]);
  const targetUserId = decodeId(match[2]);
  if (ownerUserId === null || targetUserId === null) return null;
  const page = () => decodeId(match[4]);
  const pick = (offset: number) => decodeId(match[offset] ?? undefined);
  if (match[3] === "menu") return { ownerUserId, targetUserId, action: { kind: "menu" } };
  if (match[3]!.startsWith("if:")) {
    const parsed = page();
    return parsed === null ? null : { ownerUserId, targetUserId, action: { kind: "initiatorFish", page: parsed } };
  }
  if (match[3]!.startsWith("pif:")) {
    const parsed = pick(5);
    return parsed === null ? null : { ownerUserId, targetUserId, action: { kind: "pickInitiatorFish", fishId: parsed } };
  }
  if (match[3]!.startsWith("tf:")) {
    const [offeredFishId, parsedPage] = [decodeId(match[6]), decodeId(match[7])];
    return offeredFishId === null || parsedPage === null
      ? null
      : { ownerUserId, targetUserId, action: { kind: "targetFish", offeredFishId, page: parsedPage } };
  }
  if (match[3]!.startsWith("ptf:")) {
    const [offeredFishId, fishId] = [decodeId(match[8]), decodeId(match[9])];
    return offeredFishId === null || fishId === null
      ? null
      : { ownerUserId, targetUserId, action: { kind: "pickTargetFish", offeredFishId, fishId } };
  }
  if (match[3]!.startsWith("tfm:")) {
    const parsed = decodeId(match[10]);
    return parsed === null ? null : { ownerUserId, targetUserId, action: { kind: "targetFishMoney", page: parsed } };
  }
  const fishId = decodeId(match[11]);
  return fishId === null ? null : { ownerUserId, targetUserId, action: { kind: "pickTargetFishMoney", fishId } };
}

const PUBLIC_PATTERN = /^trd:([0-9a-z]+):(a|d)$/;

export function parsePublicCallbackData(payload: string): ParsedPublicTradeData | null {
  const match = PUBLIC_PATTERN.exec(payload);
  if (match === null) return null;
  const tradeId = decodeId(match[1]);
  if (tradeId === null) return null;
  return { tradeId, action: { kind: match[2] === "a" ? "accept" : "decline" } };
}
