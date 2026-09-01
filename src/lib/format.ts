/** Two-decimal rounding, equivalent to Python's round(x, 2) for display values. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
