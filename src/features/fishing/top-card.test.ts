import { expect, test } from "bun:test";
import { createTopCard } from "./top-card.ts";

test("creates a PNG card for the inventory leaderboard", async () => {
  const card = await createTopCard([
    { firstName: "Анна<script>", total: 1_000.5 },
    { firstName: "Боб", total: 250 },
  ]);

  expect([...card.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(card.byteLength).toBeGreaterThan(1_000);
});

test("creates a PNG empty-state card", async () => {
  const card = await createTopCard([]);

  expect([...card.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
});
