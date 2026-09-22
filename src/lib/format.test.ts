import { describe, expect, test } from "bun:test";
import { formatRubles, pluralRu } from "./format.ts";

describe("pluralRu", () => {
  const forms = ["рубль", "рубля", "рублей"] as const;

  test("picks one/few/many by the last digit", () => {
    expect(pluralRu(1, forms)).toBe("рубль");
    expect(pluralRu(2, forms)).toBe("рубля");
    expect(pluralRu(4, forms)).toBe("рубля");
    expect(pluralRu(5, forms)).toBe("рублей");
    expect(pluralRu(0, forms)).toBe("рублей");
  });

  test("teens and their remainders take the many form", () => {
    expect(pluralRu(11, forms)).toBe("рублей");
    expect(pluralRu(14, forms)).toBe("рублей");
    expect(pluralRu(111, forms)).toBe("рублей");
    expect(pluralRu(21, forms)).toBe("рубль");
    expect(pluralRu(22, forms)).toBe("рубля");
  });

  test("fractional amounts take the few form", () => {
    expect(pluralRu(1.5, forms)).toBe("рубля");
    expect(pluralRu(355.25, forms)).toBe("рубля");
  });
});

describe("formatRubles", () => {
  test("appends the plural form matching the amount", () => {
    expect(formatRubles(25414)).toBe("25414 рублей");
    expect(formatRubles(355.25)).toBe("355.25 рубля");
    expect(formatRubles(1000.5)).toBe("1000.5 рубля");
  });
});
