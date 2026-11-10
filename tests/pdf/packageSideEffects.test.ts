import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = (relative: string) =>
  JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8")) as {
    sideEffects: string[];
  };

describe("PDF integration side effects", () => {
  it("retains application host and asset initialization in production bundles", () => {
    // Without these entries Rollup removes the bare bootstrap imports: the
    // worker then tries /wasm/pdfium.js instead of the versioned PWA asset.
    const { sideEffects } = manifest("../../package.json");
    expect(sideEffects).toEqual(
      expect.arrayContaining([
        "./src/services/pdfService/assets.ts",
        "./src/services/pdfService/host.ts",
      ]),
    );
  });
});
