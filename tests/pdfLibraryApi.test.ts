// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { workspacePackageAliases } from "../config/vite/workspacePackages";

const root = fileURLToPath(new URL("../", import.meta.url));
const packages = ["pdf-model", "pdf-core", "pdf-renderer"];

describe("public library API", () => {
  it.each(packages)(
    "has only explicit, built and HMR-compatible exports: %s",
    (name) => {
      const directory = path.join(root, "packages", name);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(directory, "package.json"), "utf8"),
      );
      for (const [subpath, entry] of Object.entries(manifest.exports) as [
        string,
        { import: string; types: string },
      ][]) {
        expect(subpath).not.toContain("*");
        expect(fs.existsSync(path.join(directory, entry.import))).toBe(true);
        expect(fs.existsSync(path.join(directory, entry.types))).toBe(true);
        const specifier =
          manifest.name + (subpath === "." ? "" : subpath.slice(1));
        const alias = workspacePackageAliases.find((item) =>
          item.find.test(specifier),
        );
        expect(alias, specifier).toBeDefined();
        expect(fs.existsSync(alias!.replacement), specifier).toBe(true);
      }
      expect(
        workspacePackageAliases.some((item) =>
          item.find.test(`@legir/${name}/not-a-public-module`),
        ),
      ).toBe(false);
    },
  );

  it("keeps parser/engine layout private and the headless entry small in scope", async () => {
    const core = await import("@legir/pdf-core");
    expect(typeof core.DocumentSession).toBe("function");
    expect(core).not.toHaveProperty("loadPDFInternal");
    for (const subpath of [
      "engine/runtime",
      "engine/documentSession",
      "parsers/AnnotationParsers",
      "workerProtocol",
    ]) {
      await expect(
        import(/* @vite-ignore */ `@legir/pdf-core/${subpath}`),
      ).rejects.toThrow();
    }
    const pipeline = await import("@legir/pdf-core/pipeline");
    expect(typeof pipeline.loadPdf).toBe("function");
    const content = await import("@legir/pdf-core/content");
    expect(typeof content.pdfEngine.extractText).toBe("function");
  });

  it("imports every model helper without browser globals", async () => {
    expect(typeof globalThis.window).toBe("undefined");
    expect(typeof globalThis.FileReader).toBe("undefined");
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(root, "packages/pdf-model/package.json"),
        "utf8",
      ),
    );
    for (const key of Object.keys(manifest.exports)) {
      await expect(
        import(
          /* @vite-ignore */ `@legir/pdf-model${key === "." ? "" : key.slice(1)}`
        ),
      ).resolves.toBeDefined();
    }
    const stamp = await import("@legir/pdf-model/stampImage");
    expect(stamp).not.toHaveProperty("loadStampImageFile");
    expect(stamp).not.toHaveProperty("hasStampImageTransfer");
    const config = JSON.parse(
      fs.readFileSync(
        path.join(root, "packages/pdf-model/tsconfig.json"),
        "utf8",
      ),
    );
    expect(config.compilerOptions.lib).toEqual(["ES2022"]);
  });
});
