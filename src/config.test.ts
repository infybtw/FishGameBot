import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config.ts";

const BASE_ENV: Record<string, string> = {
  BOT_TOKEN: "0:test",
  ADMIN_USER_ID: "1",
  CATCH_SUCCESS_CHANCE: "50",
  CATCH_DELAY: "0",
  CURSE_DROP_CHANCE: "0",
  DATABASE_URL: "postgres://localhost:5432/fishbot_test",
};

function envWith(curseDropChance: string | undefined): Record<string, string | undefined> {
  return { ...BASE_ENV, CURSE_DROP_CHANCE: curseDropChance };
}

describe("CURSE_DROP_CHANCE", () => {
  test("accepts the inclusive bounds 0 and 100", () => {
    expect(loadConfig(envWith("0")).curseDropChance).toBe(0);
    expect(loadConfig(envWith("100")).curseDropChance).toBe(100);
  });

  test("rejects a missing, fractional, negative, or over-100 value", () => {
    const expected = "CURSE_DROP_CHANCE must be an integer between 0 and 100";
    for (const raw of [undefined, "20.5", "-1", "101"]) {
      expect(() => loadConfig(envWith(raw))).toThrow(expected);
    }
  });
});

function envWithModifier(raw: string | undefined): Record<string, string | undefined> {
  return { ...BASE_ENV, CURSE_DROP_CHANCE: "20", FISH_MODIFIER_DROP_CHANCE: raw };
}

describe("FISH_MODIFIER_DROP_CHANCE", () => {
  test("defaults to 12 when unset or blank", () => {
    expect(loadConfig(envWithModifier(undefined)).fishModifierDropChance).toBe(12);
    expect(loadConfig(envWithModifier("")).fishModifierDropChance).toBe(12);
    expect(loadConfig(envWithModifier("  ")).fishModifierDropChance).toBe(12);
  });

  test("accepts the inclusive bounds 0 and 100", () => {
    expect(loadConfig(envWithModifier("0")).fishModifierDropChance).toBe(0);
    expect(loadConfig(envWithModifier("100")).fishModifierDropChance).toBe(100);
  });

  test("rejects a fractional, negative, over-100, or non-numeric value", () => {
    const expected = "FISH_MODIFIER_DROP_CHANCE must be an integer between 0 and 100";
    for (const raw of ["12.5", "-1", "101", "twelve"]) {
      expect(() => loadConfig(envWithModifier(raw))).toThrow(expected);
    }
  });
});

describe("EVENT_TIMEZONE", () => {
  test("falls back to Europe/Moscow when unset or blank", () => {
    expect(loadConfig({ ...BASE_ENV }).eventTimeZone).toBe("Europe/Moscow");
    expect(loadConfig({ ...BASE_ENV, EVENT_TIMEZONE: "   " }).eventTimeZone).toBe("Europe/Moscow");
  });

  test("trims and accepts any valid IANA time zone", () => {
    expect(loadConfig({ ...BASE_ENV, EVENT_TIMEZONE: "Asia/Yekaterinburg" }).eventTimeZone).toBe("Asia/Yekaterinburg");
    expect(loadConfig({ ...BASE_ENV, EVENT_TIMEZONE: " UTC " }).eventTimeZone).toBe("UTC");
  });

  test("rejects an unknown zone", () => {
    expect(() => loadConfig({ ...BASE_ENV, EVENT_TIMEZONE: "Mars/Olympus" })).toThrow(
      "EVENT_TIMEZONE must be a valid IANA time zone name",
    );
  });
});
