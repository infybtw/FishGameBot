import { expect, test } from "bun:test";
import { fixedCommandOutputMode } from "./command-output-settings.ts";

test("trade output is not transformed, preserving its private builder and public offer", () => {
  expect(fixedCommandOutputMode("trade")).toBeUndefined();
});
