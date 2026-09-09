import { getRod, type RodId } from "./rods.ts";

export type UpgradeAction =
  | { kind: "home" }
  | { kind: "fish"; page: number }
  | { kind: "sell"; fishId: number }
  | { kind: "rarities" }
  | { kind: "rarity"; point: number }
  | { kind: "sellr"; point: number; maxFishId: number }
  | { kind: "rods" }
  | { kind: "rod"; rodId: RodId }
  | { kind: "buy"; rodId: RodId }
  | { kind: "equip"; rodId: RodId };

export type ParsedCallbackData = { ownerUserId: number; action: UpgradeAction };

function isPositiveSafeInteger(value: string | undefined): value is string {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return false;
  return Number.isSafeInteger(Number(value));
}

function isRodId(value: string | undefined): value is RodId {
  return value !== undefined && getRod(value) !== undefined;
}

function assertPayload(payload: string): string {
  if (Buffer.byteLength(payload, "utf8") > 64) throw new Error("Telegram callback_data exceeds 64 bytes");
  return payload;
}

export function buildCallbackData(ownerUserId: number, action: UpgradeAction): string {
  if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0) throw new Error("Owner ID must be a positive safe integer");
  const prefix = `upg:${ownerUserId}:`;
  switch (action.kind) {
    case "home":
    case "rarities":
    case "rods":
      return assertPayload(`${prefix}${action.kind}`);
    case "fish":
      if (!Number.isSafeInteger(action.page) || action.page <= 0) throw new Error("Page must be a positive safe integer");
      return assertPayload(`${prefix}fish:${action.page}`);
    case "sell":
      if (!Number.isSafeInteger(action.fishId) || action.fishId <= 0) throw new Error("Fish ID must be a positive safe integer");
      return assertPayload(`${prefix}sell:${action.fishId}`);
    case "rarity":
      if (!Number.isSafeInteger(action.point) || action.point <= 0) throw new Error("Rarity point must be a positive safe integer");
      return assertPayload(`${prefix}rarity:${action.point}`);
    case "sellr":
      if (!Number.isSafeInteger(action.point) || action.point <= 0 || !Number.isSafeInteger(action.maxFishId) || action.maxFishId <= 0) {
        throw new Error("Rarity sale fields must be positive safe integers");
      }
      return assertPayload(`${prefix}sellr:${action.point}:${action.maxFishId}`);
    case "rod":
    case "buy":
    case "equip":
      if (getRod(action.rodId) === undefined) throw new Error("Unknown rod ID");
      return assertPayload(`${prefix}${action.kind}:${action.rodId}`);
  }
}

const CALLBACK_PATTERN = /^upg:([1-9]\d*):(home|rarities|rods|fish:([1-9]\d*)|sell:([1-9]\d*)|rarity:([1-9]\d*)|sellr:([1-9]\d*):([1-9]\d*)|(rod|buy|equip):([a-z]+))$/;

export function parseCallbackData(payload: string): ParsedCallbackData | null {
  const match = CALLBACK_PATTERN.exec(payload);
  if (match === null || !isPositiveSafeInteger(match[1])) return null;
  const ownerUserId = Number(match[1]);
  const actionText = match[2]!;
  if (actionText === "home" || actionText === "rarities" || actionText === "rods") {
    return { ownerUserId, action: { kind: actionText } };
  }
  if (isPositiveSafeInteger(match[3])) return { ownerUserId, action: { kind: "fish", page: Number(match[3]) } };
  if (isPositiveSafeInteger(match[4])) return { ownerUserId, action: { kind: "sell", fishId: Number(match[4]) } };
  if (isPositiveSafeInteger(match[5])) return { ownerUserId, action: { kind: "rarity", point: Number(match[5]) } };
  if (isPositiveSafeInteger(match[6]) && isPositiveSafeInteger(match[7])) {
    return { ownerUserId, action: { kind: "sellr", point: Number(match[6]), maxFishId: Number(match[7]) } };
  }
  if (match[8] !== undefined && isRodId(match[9])) {
    return { ownerUserId, action: { kind: match[8] as "rod" | "buy" | "equip", rodId: match[9] } };
  }
  return null;
}
