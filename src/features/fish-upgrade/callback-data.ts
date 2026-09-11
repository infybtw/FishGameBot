/**
 * Callback wire format for the personal fish upgrade menu.
 *
 * The menu is ephemeral and owner-bound: every payload carries the menu
 * owner encoded in base 36 plus the flow context (a list page or a picked
 * fish ID), staying within Telegram's 64-byte callback_data limit.
 */
export type FishUpgradeAction = { kind: "list"; page: number } | { kind: "pick"; fishId: number };

export type ParsedFishUpgradeData = { ownerUserId: number; action: FishUpgradeAction };

const PREFIX = "fup:";

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

export function buildFishUpgradeCallbackData(ownerUserId: number, action: FishUpgradeAction): string {
  const prefix = assertPayload(`${PREFIX}${encodeId(ownerUserId)}`);
  switch (action.kind) {
    case "list":
      return assertPayload(`${prefix}:l:${encodeId(action.page)}`);
    case "pick":
      return assertPayload(`${prefix}:p:${encodeId(action.fishId)}`);
  }
}

const PATTERN = new RegExp(`^${PREFIX}([0-9a-z]+):(l:([0-9a-z]+)|p:([0-9a-z]+))$`);

export function parseFishUpgradeCallbackData(payload: string): ParsedFishUpgradeData | null {
  const match = PATTERN.exec(payload);
  if (match === null) return null;
  const ownerUserId = decodeId(match[1]);
  if (ownerUserId === null) return null;
  if (match[2]!.startsWith("l:")) {
    const page = decodeId(match[3]);
    return page === null ? null : { ownerUserId, action: { kind: "list", page } };
  }
  const fishId = decodeId(match[4]);
  return fishId === null ? null : { ownerUserId, action: { kind: "pick", fishId } };
}
