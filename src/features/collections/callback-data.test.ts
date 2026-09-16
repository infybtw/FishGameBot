import { describe, expect, test } from "bun:test";
import { buildCollectionCallbackData, parseCollectionCallbackData } from "./callback-data.ts";

describe("collection callback data", () => {
  test("roundtrips every action", () => {
    for (const action of [
      { kind: "list" } as const,
      { kind: "view", collectionId: "rarity_1" } as const,
      { kind: "deposit", collectionId: "legends" } as const,
    ]) {
      const payload = buildCollectionCallbackData(42, action);
      expect(parseCollectionCallbackData(payload)).toEqual({ ownerUserId: 42, action });
    }
  });

  test("uses base 36 owner ids and stays within Telegram's byte limit", () => {
    const payload = buildCollectionCallbackData(Number.MAX_SAFE_INTEGER, { kind: "deposit", collectionId: "rarity_1" });
    expect(Buffer.byteLength(payload, "utf8")).toBeLessThanOrEqual(64);
    expect(parseCollectionCallbackData(payload)).toEqual({
      ownerUserId: Number.MAX_SAFE_INTEGER,
      action: { kind: "deposit", collectionId: "rarity_1" },
    });
  });

  test("rejects an unknown collection on both sides", () => {
    expect(() => buildCollectionCallbackData(42, { kind: "view", collectionId: "nope" })).toThrow("Unknown collection ID");
    expect(parseCollectionCallbackData("col:16:v:nope")).toBeNull();
  });

  test("rejects malformed or non-positive owner payloads", () => {
    expect(parseCollectionCallbackData("col:0:l")).toBeNull();
    expect(parseCollectionCallbackData("col::l")).toBeNull();
    expect(parseCollectionCallbackData("upg:16:l")).toBeNull();
    expect(parseCollectionCallbackData("col:16:d:legends:extra")).toBeNull();
    expect(parseCollectionCallbackData("col:16:x")).toBeNull();
  });

  test("refuses to build non-positive owner ids", () => {
    expect(() => buildCollectionCallbackData(0, { kind: "list" })).toThrow("positive safe integers");
  });
});
