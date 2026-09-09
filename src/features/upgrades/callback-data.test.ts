import { describe, expect, test } from "bun:test";
import { buildCallbackData, parseCallbackData, type UpgradeAction } from "./callback-data.ts";

const OWNER_ID = 123_456_789;

const actions: UpgradeAction[] = [
  { kind: "home" },
  { kind: "fish", page: 1 },
  { kind: "sell", fishId: 2 },
  { kind: "rarities" },
  { kind: "rarity", point: 6 },
  { kind: "sellr", point: 6, maxFishId: 999 },
  { kind: "rods" },
  { kind: "rod", rodId: "poseidon" },
  { kind: "buy", rodId: "carbon" },
  { kind: "equip", rodId: "titanium" },
];

describe("upgrade callback data", () => {
  test("round-trips every action within Telegram's callback_data limit", () => {
    for (const action of actions) {
      const payload = buildCallbackData(OWNER_ID, action);
      expect(Buffer.byteLength(payload, "utf8")).toBeLessThanOrEqual(64);
      expect(parseCallbackData(payload)).toEqual({ ownerUserId: OWNER_ID, action });
    }
  });

  test("parses the owner independently from action arguments", () => {
    const payload = buildCallbackData(OWNER_ID, { kind: "sellr", point: 4, maxFishId: 777 });
    expect(parseCallbackData(payload)?.ownerUserId).toBe(OWNER_ID);
    expect(parseCallbackData(payload)?.action).toEqual({ kind: "sellr", point: 4, maxFishId: 777 });
  });

  test("rejects malformed numeric fields and unknown rods", () => {
    for (const payload of [
      "upg:0:home",
      "upg:-1:home",
      "upg:1:fish:0",
      "upg:1:fish:-1",
      "upg:1:sell:9007199254740992",
      "upg:1:sellr:1:0",
      "upg:1:rod:unknown",
      "upg:1:home:extra",
      "not-upg:1:home",
    ]) {
      expect(parseCallbackData(payload)).toBeNull();
    }
  });

  test("rejects invalid builder inputs and protects the 64-byte boundary", () => {
    expect(() => buildCallbackData(0, { kind: "home" })).toThrow();
    expect(() => buildCallbackData(OWNER_ID, { kind: "fish", page: 0 })).toThrow();
    expect(() => buildCallbackData(Number.MAX_SAFE_INTEGER, { kind: "sellr", point: 6, maxFishId: Number.MAX_SAFE_INTEGER })).not.toThrow();
    const maximal = buildCallbackData(Number.MAX_SAFE_INTEGER, { kind: "sellr", point: 6, maxFishId: Number.MAX_SAFE_INTEGER });
    expect(Buffer.byteLength(maximal, "utf8")).toBeLessThanOrEqual(64);
  });
});
