import { expect, test } from "bun:test";
import { topCardSvg } from "./top-card.ts";

test("creates SVG markup for the inventory leaderboard", () => {
  const card = topCardSvg([
    { firstName: "Анна<script>", total: 1_000.5 },
    { firstName: "Боб", total: 250 },
  ]);

  expect(card).toContain("ТОП РЫБАКОВ");
  expect(card).toContain("@fishcatcherrbot");
  expect(card).toContain("Анна&lt;script&gt;");
  expect(card).toContain("1 000,5 руб.");
  expect(card).toContain('text-anchor="end"');
  expect(card).toContain("font-family: DejaVu Sans");
});

test("keeps long Unicode names within the name column", () => {
  const firstName = "🐟".repeat(25);
  const card = topCardSvg([{ firstName, total: 100 }]);

  expect(card).toContain(`${"🐟".repeat(23)}…`);
  expect(card).not.toContain("\ud83d…");
  expect(card).toContain('clip-path="url(#nameColumn)"');
});

test("creates an empty-state SVG card", () => {
  const card = topCardSvg([]);

  expect(card).toContain("Топ инвентарей пока пустует");
});
