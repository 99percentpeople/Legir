import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("retains both published worker entry points in production bundles", () => {
  const { sideEffects } = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  expect(sideEffects).toEqual(
    expect.arrayContaining(["./dist/worker.js", "./dist/content-worker.js"]),
  );
});
