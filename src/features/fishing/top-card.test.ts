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
  expect(card).toContain("text { font-family: DejaVu Sans");
  expect(card).toContain(".name { fill: #f2feff; font-family: Noto Sans, Noto Color Emoji");
});

test("keeps long international names within the name column", () => {
  const firstName = "レナート🐟".repeat(25);
  const card = topCardSvg([{ firstName, total: 100 }]);

  expect(card).toContain(`${Array.from(firstName).slice(0, 23).join("")}…`);
  expect(card).not.toContain("\ud83d…");
  expect(card).toContain('clip-path="url(#nameColumn)"');
});

test("uses fonts covering CJK and emoji nicknames", () => {
  const card = topCardSvg([
    { firstName: "レナート", total: 100 },
    { firstName: "侍", total: 50 },
    { firstName: "👻", total: 25 },
  ]);

  expect(card).toContain("レナート");
  expect(card).toContain("侍");
  expect(card).toContain("👻");
  expect(card).toContain(".name { fill: #f2feff; font-family: Noto Sans, Noto Color Emoji");
});

test("creates an empty-state SVG card", () => {
  const card = topCardSvg([]);

  expect(card).toContain("Топ инвентарей пока пустует");
});
