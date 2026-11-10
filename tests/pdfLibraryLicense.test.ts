// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const names = ["pdf-model", "pdfium", "pdf-core", "pdf-renderer"];

describe("PDF library license boundary", () => {
  it.each(names)("ships MIT metadata and license text in @legir/%s", (name) => {
    const temporary = mkdtempSync(
      path.join(os.tmpdir(), "legir-license-test-"),
    );
    const source = path.join(root, "packages", name);
    const filename = path.join(temporary, "library.tgz");
    const unpacked = path.join(temporary, "unpacked");
    mkdirSync(unpacked);
    try {
      execFileSync(
        "bun",
        ["pm", "pack", "--ignore-scripts", "--filename", filename, "--quiet"],
        {
          cwd: source,
          stdio: "pipe",
        },
      );
      execFileSync("tar", ["-xzf", filename, "-C", unpacked]);
      const installed = path.join(unpacked, "package");
      const metadata = JSON.parse(
        readFileSync(path.join(installed, "package.json"), "utf8"),
      );
      expect(metadata.license).toBe("MIT");
      const license = readFileSync(path.join(installed, "LICENSE"), "utf8");
      expect(license).toBe(readFileSync(path.join(source, "LICENSE"), "utf8"));
      expect(license).toMatch(/^MIT License\n/);
      expect(license).toContain("Copyright (c) 2026 Legir contributors");
      expect(license).toContain("Permission is hereby granted, free of charge");
      expect(license).toContain(
        "The above copyright notice and this permission notice shall be included",
      );
      expect(license).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
      if (name === "pdfium") {
        expect(license).toContain(
          "MIT is an additional license option for those files",
        );
        expect(license).toContain(
          "Historical BSD 3-Clause License for Legir-authored code",
        );
        const notices = path.join(source, "wasm/licenses");
        const files = readdirSync(notices);
        expect(files).toContain("pdfium.txt");
        expect(files).toContain("emscripten.txt");
        for (const notice of files) {
          expect(
            readFileSync(path.join(installed, "wasm/licenses", notice)),
          ).toEqual(readFileSync(path.join(notices, notice)));
        }
        // Relicensing must not modify the source or binary bytes recorded by
        // provenance.json. The normal package build also verifies those hashes.
        expect(readFileSync(path.join(installed, "native/bridge.cpp"))).toEqual(
          readFileSync(path.join(source, "native/bridge.cpp")),
        );
        expect(
          readFileSync(path.join(installed, "wasm/provenance.json")),
        ).toEqual(readFileSync(path.join(source, "wasm/provenance.json")));
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("keeps the Legir application under AGPL", () => {
    expect(
      JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).license,
    ).toBe("AGPL-3.0-or-later");
    expect(readFileSync(path.join(root, "LICENSE"), "utf8")).toContain(
      "GNU AFFERO GENERAL PUBLIC LICENSE",
    );
  });
});
