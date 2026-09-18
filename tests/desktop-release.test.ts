// @vitest-environment node
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  prepareRelease,
  stageInstallers,
  validateDesktopVersions,
  validateReleaseAssets,
} from "../scripts/desktop-release";

const names = [
  "Legir_0.1.0_x64-setup.exe",
  "Legir_0.1.0_windows_x64_portable.zip",
  "Legir_0.1.0_x64.dmg",
  "Legir_0.1.0_aarch64.dmg",
  "Legir_0.1.0_amd64.deb",
  "Legir_0.1.0_arm64.deb",
  "Legir_0.1.0_macos_x64_portable.tar.gz",
  "Legir_0.1.0_macos_arm64_portable.tar.gz",
  "Legir_0.1.0_amd64.AppImage",
  "Legir_0.1.0_aarch64.AppImage",
];
const files = names.map((name) => ({ name, size: 123 }));
const manifest =
  '[package]\nname = "Legir"\nversion = "0.1.0"\n\n[dependencies]\nversion = "9.9.9"\n';

describe("desktop release publication gates", () => {
  it("requires package, Tauri and Rust versions to match the stable tag", () => {
    expect(validateDesktopVersions("0.1.0", "0.1.0", manifest, "v0.1.0")).toBe(
      "0.1.0",
    );
    expect(
      validateDesktopVersions(
        "0.1.0",
        "0.1.0",
        manifest.replaceAll("\n", "\r\n"),
      ),
    ).toBe("0.1.0");
  });
  it.each(["main", "v0.2.0", "v0.1.0-beta.1", "0.1.0", ""])(
    "rejects a bad release tag: %s",
    (tag) => {
      expect(() =>
        validateDesktopVersions("0.1.0", "0.1.0", manifest, tag),
      ).toThrow("Release tag must be");
    },
  );
  it("rejects inconsistent versions and dependency versions masquerading as the package", () => {
    expect(() => validateDesktopVersions("0.0.0", "0.1.0", manifest)).toThrow(
      "must match",
    );
    expect(() =>
      validateDesktopVersions(
        "0.1.0",
        "0.1.0",
        '[dependencies]\nversion = "0.1.0"',
      ),
    ).toThrow("missing");
  });
  it("accepts one installer and one no-install package for each target", () => {
    expect(() => validateReleaseAssets("0.1.0", files)).not.toThrow();
  });
  it("blocks incomplete platforms and wrong-version installers", () => {
    expect(() => validateReleaseAssets("0.1.0", files.slice(1))).toThrow(
      "windows/x64/exe",
    );
    expect(() =>
      validateReleaseAssets("0.1.0", [
        { name: "Legir_0.2.0_x64.dmg", size: 123 },
      ]),
    ).toThrow("release version");
    expect(() => validateReleaseAssets("0.1.0", [])).toThrow(
      "Missing downloads",
    );
  });
  it.each([
    "Legir_0.1.0_windows_x64_portable.zip",
    "Legir_0.1.0_macos_arm64_portable.tar.gz",
    "Legir_0.1.0_amd64.AppImage",
  ])("blocks a release missing the no-install package %s", (name) => {
    expect(() =>
      validateReleaseAssets(
        "0.1.0",
        files.filter((file) => file.name !== name),
      ),
    ).toThrow("Missing downloads");
  });
  it.each(["Legir_0.1.0_x64_en-US.msi", "Legir-0.1.0-1.x86_64.rpm"])(
    "rejects removed format %s even when all supported packages exist",
    (name) => {
      expect(() =>
        validateReleaseAssets("0.1.0", [...files, { name, size: 1 }]),
      ).toThrow("unrecognized");
    },
  );
  it("blocks empty uploads and duplicate/extra loose binaries", () => {
    expect(() =>
      validateReleaseAssets(
        "0.1.0",
        files.map((file) => ({ ...file, size: 0 })),
      ),
    ).toThrow("empty");
    expect(() => validateReleaseAssets("0.1.0", [...files, files[0]])).toThrow(
      "duplicate",
    );
    expect(() =>
      validateReleaseAssets("0.1.0", [
        ...files,
        { name: "Legir_0.1.0_x64.exe", size: 1 },
      ]),
    ).toThrow("unrecognized");
  });
});

describe("installer staging and checksums", () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });
  async function temporaryDirectory() {
    const directory = await mkdtemp(join(tmpdir(), "legir-release-test-"));
    directories.push(directory);
    return directory;
  }
  it("flattens bundle directories and excludes raw app internals", async () => {
    const directory = await temporaryDirectory();
    const bundles = join(directory, "bundle");
    await mkdir(join(bundles, "dmg"), { recursive: true });
    await mkdir(join(bundles, "macos", "Legir.app"), { recursive: true });
    await writeFile(join(bundles, "dmg", names[2]), "installer");
    await writeFile(join(bundles, "dmg", "background.png"), "not an installer");
    await mkdir(join(bundles, "msi"));
    await mkdir(join(bundles, "rpm"));
    await writeFile(
      join(bundles, "msi", "Legir_0.1.0_x64_en-US.msi"),
      "stale installer",
    );
    await writeFile(
      join(bundles, "rpm", "Legir-0.1.0-1.x86_64.rpm"),
      "stale installer",
    );
    const destination = join(directory, "staged");
    await stageInstallers(bundles, destination);
    expect(await readdir(destination)).toEqual([names[2]]);
    expect(await readFile(join(destination, names[2]), "utf8")).toBe(
      "installer",
    );
  });
  it("fails rather than uploading an empty artifact", async () => {
    const directory = await temporaryDirectory();
    await expect(
      stageInstallers(join(directory, "missing"), join(directory, "staged")),
    ).rejects.toThrow("No installers");
  });
  it("writes deterministic SHA-256 checksums only for a complete release", async () => {
    const directory = await temporaryDirectory();
    await Promise.all(
      names.map((name) => writeFile(join(directory, name), `fixture:${name}`)),
    );
    await prepareRelease(directory, "0.1.0");
    const first = await readFile(join(directory, "SHA256SUMS.txt"), "utf8");
    expect(first.trim().split("\n")).toHaveLength(10);
    for (const name of names) {
      expect(first).toContain(
        `${createHash("sha256").update(`fixture:${name}`).digest("hex")}  ${name}`,
      );
    }
    await prepareRelease(directory, "0.1.0");
    expect(await readFile(join(directory, "SHA256SUMS.txt"), "utf8")).toBe(
      first,
    );
  });
});
