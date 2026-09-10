export type NetAction = { kind: "cast" } | { kind: "collect" };

export type ParsedNetCallbackData = { ownerUserId: number; action: NetAction };

function isPositiveSafeInteger(value: string | undefined): value is string {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return false;
  return Number.isSafeInteger(Number(value));
}

function assertPayload(payload: string): string {
  if (Buffer.byteLength(payload, "utf8") > 64) throw new Error("Telegram callback_data exceeds 64 bytes");
  return payload;
}

export function buildNetCallbackData(ownerUserId: number, action: NetAction): string {
  if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0) throw new Error("Owner ID must be a positive safe integer");
  return assertPayload(`net:${ownerUserId}:${action.kind}`);
}

const NET_CALLBACK_PATTERN = /^net:([1-9]\d*):(cast|collect)$/;

export function parseNetCallbackData(payload: string): ParsedNetCallbackData | null {
  const match = NET_CALLBACK_PATTERN.exec(payload);
  if (match === null || !isPositiveSafeInteger(match[1])) return null;
  return { ownerUserId: Number(match[1]), action: { kind: match[2] as "cast" | "collect" } };
}
