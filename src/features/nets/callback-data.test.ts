import { describe, expect, test } from "bun:test";
import { buildNetCallbackData, parseNetCallbackData } from "./callback-data.ts";

const OWNER_ID = 123_456_789;

describe("net callback data", () => {
  test("round-trips cast and collect payloads within Telegram's limit", () => {
    for (const action of [{ kind: "cast" }, { kind: "collect" }] as const) {
      const payload = buildNetCallbackData(OWNER_ID, action);
      expect(Buffer.byteLength(payload, "utf8")).toBeLessThanOrEqual(64);
      expect(parseNetCallbackData(payload)).toEqual({ ownerUserId: OWNER_ID, action });
    }
  });

  test("preserves a positive safe owner ID at both extremes", () => {
    expect(parseNetCallbackData(buildNetCallbackData(1, { kind: "cast" }))).toEqual({
      ownerUserId: 1,
      action: { kind: "cast" },
    });
    const maximal = buildNetCallbackData(Number.MAX_SAFE_INTEGER, { kind: "collect" });
    expect(parseNetCallbackData(maximal)).toEqual({
      ownerUserId: Number.MAX_SAFE_INTEGER,
      action: { kind: "collect" },
    });
  });

  test("rejects malformed, oversized, and invalid-owner payloads", () => {
    for (const payload of [
      "",
      "net",
      "net:",
      "net:0:cast",
      "net:-1:collect",
      "net:1.5:cast",
      "net:1:cancel",
      "net:1",
      "net:1:cast:extra",
      `net:${"9".repeat(30)}:cast`,
      "upg:1:home",
      "net:1:CAST",
    ]) {
      expect(parseNetCallbackData(payload)).toBeNull();
    }
  });

  test("builder rejects owner IDs that are not positive safe integers", () => {
    expect(() => buildNetCallbackData(0, { kind: "cast" })).toThrow();
    expect(() => buildNetCallbackData(-5, { kind: "collect" })).toThrow();
    expect(() => buildNetCallbackData(Number.MAX_SAFE_INTEGER + 1, { kind: "cast" })).toThrow();
    expect(() => buildNetCallbackData(Number.NaN, { kind: "cast" })).toThrow();
  });
});
