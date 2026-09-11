import { describe, expect, test } from "bun:test";
import { buildFishUpgradeCallbackData, parseFishUpgradeCallbackData, type FishUpgradeAction } from "./callback-data.ts";

const OWNER_ID = 123_456_789;
const MAX = Number.MAX_SAFE_INTEGER;

const actions: FishUpgradeAction[] = [
  { kind: "list", page: 1 },
  { kind: "confirm", fishId: 42 },
  { kind: "apply", fishId: 42 },
];

describe("fish upgrade callback data", () => {
  test("round-trips every action within Telegram's callback_data limit", () => {
    for (const action of actions) {
      const payload = buildFishUpgradeCallbackData(OWNER_ID, action);
      expect(Buffer.byteLength(payload, "utf8")).toBeLessThanOrEqual(64);
      expect(parseFishUpgradeCallbackData(payload)).toEqual({ ownerUserId: OWNER_ID, action });
    }
  });

  test("round-trips maximal base-36 IDs within the 64-byte limit", () => {
    for (const action of actions) {
      const payload = buildFishUpgradeCallbackData(MAX, action);
      expect(Buffer.byteLength(payload, "utf8")).toBeLessThanOrEqual(64);
      expect(parseFishUpgradeCallbackData(payload)).toEqual({ ownerUserId: MAX, action });
    }
  });

  test("rejects malformed, unknown, and trailing-field payloads", () => {
    for (const payload of [
      "fup:0:l:1",
      "fup:-1:c:1",
      "fup:1:l:0",
      "fup:1:l:-1",
      "fup:1:l:1.5",
      "fup:1:c:0",
      "fup:1:a:0",
      "fup:1:a:9007199254740992",
      "fup:1:p:1",
      "fup:1:x:1",
      "fup:1:a:1g!",
      "fup:1:a:1:extra",
      "fup:1:a",
      "fup:1",
      "fup:zz!,#:l:1",
      "fup",
      "tr:1:l:1",
      "fupd:1:l:1",
    ]) {
      expect(parseFishUpgradeCallbackData(payload)).toBeNull();
    }
  });

  test("rejects invalid builder inputs", () => {
    for (const [owner, action] of [
      [0, { kind: "list", page: 1 }],
      [-1, { kind: "list", page: 1 }],
      [Number.MAX_SAFE_INTEGER + 1, { kind: "list", page: 1 }],
      [OWNER_ID, { kind: "list", page: 0 }],
      [OWNER_ID, { kind: "confirm", fishId: 0 }],
      [OWNER_ID, { kind: "confirm", fishId: -5 }],
      [OWNER_ID, { kind: "apply", fishId: 0 }],
      [OWNER_ID, { kind: "apply", fishId: Number.MAX_SAFE_INTEGER + 1 }],
    ] as const) {
      expect(() => buildFishUpgradeCallbackData(owner, action)).toThrow();
    }
  });
});
