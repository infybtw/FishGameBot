import { describe, expect, test } from "bun:test";
import {
  buildMenuCallbackData,
  buildPublicCallbackData,
  parseMenuCallbackData,
  parsePublicCallbackData,
  type PublicTradeAction,
  type TradeMenuAction,
} from "./callback-data.ts";

const OWNER_ID = 123_456_789;
const TARGET_ID = 987_654_321;
const MAX = Number.MAX_SAFE_INTEGER;

const menuActions: TradeMenuAction[] = [
  { kind: "menu" },
  { kind: "initiatorFish", page: 1 },
  { kind: "pickInitiatorFish", fishId: 2 },
  { kind: "targetFish", offeredFishId: 2, page: 3 },
  { kind: "pickTargetFish", offeredFishId: 2, fishId: 5 },
  { kind: "targetFishMoney", page: 1 },
  { kind: "pickTargetFishMoney", fishId: 5 },
];

const publicActions: PublicTradeAction[] = [{ kind: "accept" }, { kind: "decline" }];

describe("trade menu callback data", () => {
  test("round-trips every action within Telegram's callback_data limit", () => {
    for (const action of menuActions) {
      const payload = buildMenuCallbackData(OWNER_ID, TARGET_ID, action);
      expect(Buffer.byteLength(payload, "utf8")).toBeLessThanOrEqual(64);
      expect(parseMenuCallbackData(payload)).toEqual({ ownerUserId: OWNER_ID, targetUserId: TARGET_ID, action });
    }
  });

  test("round-trips maximal base-36 IDs within the 64-byte limit", () => {
    for (const action of menuActions) {
      const payload = buildMenuCallbackData(MAX, MAX, action);
      expect(Buffer.byteLength(payload, "utf8")).toBeLessThanOrEqual(64);
      expect(parseMenuCallbackData(payload)).toEqual({ ownerUserId: MAX, targetUserId: MAX, action });
    }
  });

  test("rejects zero, unsafe, malformed, unknown, and trailing-field payloads", () => {
    for (const payload of [
      "tr:0:1:menu",
      "tr:1:0:menu",
      "tr:-1:1:menu",
      "tr:1:1:menu:extra",
      "tr:1:1:unknown",
      "tr:1:1:if:0",
      "tr:1:1:if:-1",
      "tr:1:1:if:1.5",
      "tr:1:1:if:1g!",
      "tr:1:1:pif:9007199254740992",
      "tr:1:1:tf:1",
      "tr:1:1:tf:1:0",
      "tr:1:1:tf:1:2:3",
      "tr:1:1:ptf:1",
      "tr:1:1:ptfm:0",
      "tr:1:menu",
      "trd:1:a",
      "tx:1:1:menu",
    ]) {
      expect(parseMenuCallbackData(payload)).toBeNull();
    }
  });

  test("rejects invalid builder inputs", () => {
    for (const [owner, target, action] of [
      [0, TARGET_ID, { kind: "menu" }],
      [OWNER_ID, 0, { kind: "menu" }],
      [OWNER_ID, TARGET_ID, { kind: "initiatorFish", page: 0 }],
      [OWNER_ID, TARGET_ID, { kind: "pickInitiatorFish", fishId: -1 }],
      [Number.MAX_SAFE_INTEGER + 1, TARGET_ID, { kind: "menu" }],
    ] as const) {
      expect(() => buildMenuCallbackData(owner, target, action)).toThrow();
    }
  });
});

describe("public trade callback data", () => {
  test("round-trips both verbs with maximal trade IDs", () => {
    for (const action of publicActions) {
      const payload = buildPublicCallbackData(MAX, action);
      expect(Buffer.byteLength(payload, "utf8")).toBeLessThanOrEqual(64);
      expect(parsePublicCallbackData(payload)).toEqual({ tradeId: MAX, action });
    }
  });

  test("rejects malformed trade payloads", () => {
    for (const payload of [
      "trd:0:a",
      "trd:-1:a",
      "trd:1:x",
      "trd:1:a:extra",
      "trd:1",
      "trd:9007199254740992:a",
      "trd:zz!,#:a",
      "tr:1:a",
    ]) {
      expect(parsePublicCallbackData(payload)).toBeNull();
    }
  });

  test("rejects invalid builder inputs", () => {
    expect(() => buildPublicCallbackData(0, { kind: "accept" })).toThrow();
    expect(() => buildPublicCallbackData(MAX, { kind: "accept" })).not.toThrow();
  });
});
