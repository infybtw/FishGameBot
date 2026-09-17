import { getRod, type RodId } from "./rods.ts";
import { getRodCase, type RodCaseId } from "../rod-cases/catalog.ts";

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
  | { kind: "equip"; rodId: RodId }
  | { kind: "reforge"; rodId: RodId; page: number }
  | { kind: "reforgeapply"; rodId: RodId; fishId: number }
  | { kind: "cases" }
  | { kind: "casebuy"; caseId: RodCaseId }
  | { kind: "caseopen"; caseId: RodCaseId };

export type ParsedCallbackData = { ownerUserId: number; action: UpgradeAction };

function isPositiveSafeInteger(value: string | undefined): value is string {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return false;
  return Number.isSafeInteger(Number(value));
}

function isRodId(value: string | undefined): value is RodId {
  return value !== undefined && getRod(value) !== undefined;
}
function isRodCaseId(value: string | undefined): value is RodCaseId { return value !== undefined && getRodCase(value) !== undefined; }

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
    case "cases":
      return assertPayload(`${prefix}${action.kind}`);
    case "fish":
      if (!Number.isSafeInteger(action.page) || action.page <= 0) throw new Error("Page must be a positive safe integer");
      return assertPayload(`${prefix}fish:${action.page}`);
    case "reforge":
      if (getRod(action.rodId) === undefined || !Number.isSafeInteger(action.page) || action.page <= 0) throw new Error("Invalid reforge screen");
      return assertPayload(`${prefix}reforge:${action.rodId}:${action.page}`);
    case "reforgeapply":
      if (getRod(action.rodId) === undefined || !Number.isSafeInteger(action.fishId) || action.fishId <= 0) throw new Error("Invalid reforge application");
      return assertPayload(`${prefix}reforgeapply:${action.rodId}:${action.fishId}`);
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
    case "casebuy":
    case "caseopen":
      if (getRodCase(action.caseId) === undefined) throw new Error("Unknown rod case ID");
      return assertPayload(`${prefix}${action.kind}:${action.caseId}`);
  }
}

const CALLBACK_PATTERN = /^upg:([1-9]\d*):(home|rarities|rods|cases|fish:([1-9]\d*)|sell:([1-9]\d*)|rarity:([1-9]\d*)|sellr:([1-9]\d*):([1-9]\d*)|reforge:([a-z_]+):([1-9]\d*)|reforgeapply:([a-z_]+):([1-9]\d*)|(rod|buy|equip|casebuy|caseopen):([a-z_]+))$/;

export function parseCallbackData(payload: string): ParsedCallbackData | null {
  const match = CALLBACK_PATTERN.exec(payload);
  if (match === null || !isPositiveSafeInteger(match[1])) return null;
  const ownerUserId = Number(match[1]);
  const actionText = match[2]!;
  if (actionText === "home" || actionText === "rarities" || actionText === "rods" || actionText === "cases") {
    return { ownerUserId, action: { kind: actionText } };
  }
  if (isPositiveSafeInteger(match[3])) return { ownerUserId, action: { kind: "fish", page: Number(match[3]) } };
  if (isPositiveSafeInteger(match[4])) return { ownerUserId, action: { kind: "sell", fishId: Number(match[4]) } };
  if (isPositiveSafeInteger(match[5])) return { ownerUserId, action: { kind: "rarity", point: Number(match[5]) } };
  if (isPositiveSafeInteger(match[6]) && isPositiveSafeInteger(match[7])) {
    return { ownerUserId, action: { kind: "sellr", point: Number(match[6]), maxFishId: Number(match[7]) } };
  }
  if (isRodId(match[8]) && isPositiveSafeInteger(match[9])) {
    return { ownerUserId, action: { kind: "reforge", rodId: match[8], page: Number(match[9]) } };
  }
  if (isRodId(match[10]) && isPositiveSafeInteger(match[11])) {
    return { ownerUserId, action: { kind: "reforgeapply", rodId: match[10], fishId: Number(match[11]) } };
  }
  if (match[12] === "casebuy" || match[12] === "caseopen") {
    return isRodCaseId(match[13]) ? { ownerUserId, action: { kind: match[12], caseId: match[13] } } : null;
  }
  if (match[12] !== undefined && isRodId(match[13])) {
    return { ownerUserId, action: { kind: match[12] as "rod" | "buy" | "equip", rodId: match[13] } };
  }
  return null;
}
