// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  npmPackageMetadata,
  packNpmLibraries,
  releaseVersion,
} from "../scripts/pack-npm-libraries";

// This temporary repository has its own synthetic version. It deliberately
// does not track the real workspace version and needs no release-time updates.
const fixtureVersion = "1.2.3";
const fixtureTag = `pdf-libs-v${fixtureVersion}`;

describe("npm PDF library releases", () => {
  it.each([true, false])(
    "packs clean source with verifiable checksums (tagged=%s)",
    async (tagged) => {
      const temporary = mkdtempSync(path.join(os.tmpdir(), "legir-pack-test-"));
      const source = path.join(temporary, "source");
      const output = path.join(temporary, "output");
      mkdirSync(source);
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: source, stdio: "pipe" });
      try {
        for (const name of [
          "pdf-model",
          "pdfium",
          "pdf-core",
          "pdf-renderer",
        ]) {
          const directory = path.join(source, "packages", name);
          mkdirSync(path.join(directory, "dist"), { recursive: true });
          writeFileSync(path.join(directory, "dist/index.js"), "export {};\n");
          writeFileSync(
            path.join(directory, "package.json"),
            JSON.stringify({
              name: `@legir/${name}`,
              version: fixtureVersion,
              files: ["dist"],
              scripts: { prepack: "exit 1" },
              dependencies:
                name === "pdf-core"
                  ? { "@legir/pdf-model": "workspace:*" }
                  : {},
            }),
          );
        }
        git("init", "-q");
        git("add", ".");
        git(
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.invalid",
          "-c",
          "commit.gpgsign=false",
          "commit",
          "-qm",
          "fixture",
        );
        git("tag", fixtureTag);
        if (!tagged) {
          // Historical tags must not have to be moved for a manual npm release.
          git(
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--allow-empty",
            "-qm",
            "manual source",
          );
          expect(git("rev-parse", fixtureTag).toString()).not.toBe(
            git("rev-parse", "HEAD").toString(),
          );
        }
        await packNpmLibraries(source, tagged ? fixtureTag : null, output);
        expect(
          execFileSync("sha256sum", ["-c", "SHA256SUMS.txt"], {
            cwd: output,
            encoding: "utf8",
            env: { ...process.env, LC_ALL: "C" },
          }),
        ).toContain("legir-libraries.json: OK");
        const metadata = JSON.parse(
          execFileSync(
            "tar",
            [
              "-xzOf",
              path.join(output, `legir-pdf-core-${fixtureVersion}.tgz`),
              "package/package.json",
            ],
            { encoding: "utf8" },
          ),
        );
        expect(metadata.dependencies["@legir/pdf-model"]).toBe(fixtureVersion);
        const manifest = JSON.parse(
          readFileSync(path.join(output, "legir-libraries.json"), "utf8"),
        );
        expect(manifest.packages).toHaveLength(4);
        expect(manifest.version).toBe(fixtureVersion);
        expect(manifest.tag).toBe(tagged ? fixtureTag : null);
        expect(metadata.legirRelease).toEqual({
          revision: manifest.revision,
          tag: manifest.tag,
        });
        expect(manifest.revision).toBe(
          git("rev-parse", "HEAD").toString().trim(),
        );
        writeFileSync(path.join(source, "uncommitted.txt"), "dirty source");
        await expect(
          packNpmLibraries(source, tagged ? fixtureTag : null, output),
        ).rejects.toThrow("clean");
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it("rewrites internal workspace dependencies to the release version", () => {
    const source = {
      name: "@legir/pdf-core",
      version: "0.1.0",
      dependencies: {
        "@legir/pdf-model": "workspace:*",
        "@legir/pdfium": "workspace:*",
        "pdf-fontkit": "^1.8.9",
      },
    };
    const result = npmPackageMetadata(
      source,
      "pdf-libs-v0.1.0",
      "a".repeat(40),
    );
    expect(result.dependencies["@legir/pdf-model"]).toBe("0.1.0");
    expect(result.dependencies["@legir/pdfium"]).toBe("0.1.0");
    expect(result.dependencies["pdf-fontkit"]).toBe("^1.8.9");
    expect(source.dependencies["@legir/pdf-model"]).toBe("workspace:*");
    expect(result.publishConfig).toEqual({ access: "public" });
    expect(result.repository).toEqual({
      type: "git",
      url: "https://github.com/99percentpeople/Legir.git",
      directory: "packages/pdf-core",
    });
    expect(result.legirRelease).toEqual({
      revision: "a".repeat(40),
      tag: "pdf-libs-v0.1.0",
    });
  });

  it("keeps existing publishConfig keys and rewrites peer ranges", () => {
    const result = npmPackageMetadata(
      {
        name: "@legir/pdf-renderer",
        version: "0.1.0",
        publishConfig: { tag: "next" },
        peerDependencies: { "@legir/pdf-core": "workspace:^" },
      },
      "pdf-libs-v0.1.0",
      "a".repeat(40),
    );
    expect(result.publishConfig).toEqual({ tag: "next", access: "public" });
    expect(result.peerDependencies?.["@legir/pdf-core"]).toBe("0.1.0");
  });

  it("rejects desktop tags, mismatched versions and unknown workspaces", () => {
    expect(() => releaseVersion("v0.1.0")).toThrow();
    expect(() => releaseVersion("pdf-libs-v0.1")).toThrow();
    expect(() =>
      npmPackageMetadata(
        { name: "@legir/pdf-model", version: "0.2.0" },
        "pdf-libs-v0.1.0",
        "a".repeat(40),
      ),
    ).toThrow();
    expect(() =>
      npmPackageMetadata(
        {
          name: "@legir/pdf-core",
          version: "0.1.0",
          dependencies: { app: "workspace:*" },
        },
        "pdf-libs-v0.1.0",
        "a".repeat(40),
      ),
    ).toThrow();
    expect(() =>
      npmPackageMetadata(
        {
          name: "@legir/pdf-core",
          version: "0.1.0",
          dependencies: { "@legir/unknown": "workspace:*" },
        },
        "pdf-libs-v0.1.0",
        "a".repeat(40),
      ),
    ).toThrow();
    expect(() =>
      npmPackageMetadata(
        { name: "legir-pdf-core", version: "0.1.0" },
        "pdf-libs-v0.1.0",
        "a".repeat(40),
      ),
    ).toThrow();
  });

  it("rejects private packages", () => {
    expect(() =>
      npmPackageMetadata(
        { name: "@legir/pdf-model", version: "0.1.0", private: true },
        "pdf-libs-v0.1.0",
        "a".repeat(40),
      ),
    ).toThrow();
  });
});
