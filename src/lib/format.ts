/** Two-decimal rounding, equivalent to Python's round(x, 2) for display values. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Russian plural form: 1/21 → `one`, 2–4/22–24 → `few`, 0/5–20 → `many`.
 * Fractional amounts take the `few` form («1,5 рубля»).
 */
export function pluralRu(count: number, forms: readonly [string, string, string]): string {
  if (!Number.isInteger(count)) return forms[1];
  const hundred = Math.abs(count) % 100;
  if (hundred >= 11 && hundred <= 14) return forms[2];
  const last = hundred % 10;
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

/** Formats an amount followed by the correct Russian plural of «рубль». */
export function formatRubles(amount: number): string {
  return `${round2(amount)} ${pluralRu(amount, ["рубль", "рубля", "рублей"])}`;
}
