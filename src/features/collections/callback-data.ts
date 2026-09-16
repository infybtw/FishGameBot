import { getCollection } from "./catalog.ts";

/**
 * Callback wire format for the personal collections menu.
 *
 * The menu lives in a public group message but is owner-bound: every payload
 * carries the owner encoded in base 36 plus the action, staying within
 * Telegram's 64-byte callback_data limit. Owned collection IDs are validated
 * against the catalog on both encode and decode.
 */
export type CollectionAction =
  | { kind: "list" }
  | { kind: "view"; collectionId: string }
  | { kind: "deposit"; collectionId: string };

export type ParsedCollectionData = { ownerUserId: number; action: CollectionAction };

const PREFIX = "col:";

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

function isCollectionId(value: string | undefined): value is string {
  return value !== undefined && getCollection(value) !== undefined;
}

function assertPayload(payload: string): string {
  if (Buffer.byteLength(payload, "utf8") > 64) throw new Error("Telegram callback_data exceeds 64 bytes");
  return payload;
}

export function buildCollectionCallbackData(ownerUserId: number, action: CollectionAction): string {
  const prefix = `${PREFIX}${encodeId(ownerUserId)}`;
  switch (action.kind) {
    case "list":
      return assertPayload(`${prefix}:l`);
    case "view":
    case "deposit": {
      const collection = getCollection(action.collectionId);
      if (collection === undefined) throw new Error("Unknown collection ID");
      return assertPayload(`${prefix}:${action.kind === "view" ? "v" : "d"}:${collection.id}`);
    }
  }
}

const PATTERN = new RegExp(`^${PREFIX}([0-9a-z]+):(l|v:([a-z0-9_]+)|d:([a-z0-9_]+))$`);

export function parseCollectionCallbackData(payload: string): ParsedCollectionData | null {
  const match = PATTERN.exec(payload);
  if (match === null) return null;
  const ownerUserId = decodeId(match[1]);
  if (ownerUserId === null) return null;
  const actionText = match[2]!;
  if (actionText === "l") return { ownerUserId, action: { kind: "list" } };
  if (actionText.startsWith("v:")) {
    return isCollectionId(match[3]) ? { ownerUserId, action: { kind: "view", collectionId: match[3] } } : null;
  }
  return isCollectionId(match[4]) ? { ownerUserId, action: { kind: "deposit", collectionId: match[4] } } : null;
}
