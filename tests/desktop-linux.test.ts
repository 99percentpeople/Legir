// @vitest-environment node
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  linuxExecutableName,
  stageLinuxExecutable,
  validateLinuxExecutable,
} from "../scripts/desktop-linux";
import { parseDesktopRelease, RELEASES_URL } from "../www/src/lib/downloads";
import { linuxExecutableFixture } from "./helpers/linuxExecutable";

const directories: string[] = [];
async function fixture(arch: "x64" | "arm64" = "x64") {
  const root = await mkdtemp(join(tmpdir(), "legir-linux-test-"));
  directories.push(root);
  await mkdir(join(root, "src-tauri"));
  for (const name of ["tauri.conf.json", "tauri.linux.conf.json"]) {
    await writeFile(
      join(root, "src-tauri", name),
      JSON.stringify({ bundle: { targets: ["deb"] } }),
    );
  }
  const release = join(root, "release");
  await mkdir(release);
  const binary = join(release, "Legir");
  await writeFile(binary, linuxExecutableFixture(arch));
  return { root, release, binary, destination: join(root, "out") };
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("native Linux downloads", () => {
  it.each([
    ["x86_64-unknown-linux-gnu", "x64"],
    ["aarch64-unknown-linux-gnu", "arm64"],
  ] as const)(
    "stages the unmodified ELF with an extensionless website-recognized name for %s",
    async (target, arch) => {
      const f = await fixture(arch);
      const name = linuxExecutableName(target, "0.1.1");
      expect(name).toBe(`Legir_0.1.1_linux_${arch}_portable`);
      const output = await stageLinuxExecutable(
        target,
        f.release,
        f.destination,
        "0.1.1",
        f.root,
      );
      expect(await readdir(f.destination)).toEqual([name]);
      expect(await readFile(output)).toEqual(await readFile(f.binary));
      if (process.platform !== "win32")
        expect((await stat(output)).mode & 0o777).toBe(0o755);
      const release = parseDesktopRelease({
        tag_name: "v0.1.1",
        draft: false,
        prerelease: false,
        assets: [
          {
            name,
            state: "uploaded",
            size: 128,
            browser_download_url: `${RELEASES_URL}/download/v0.1.1/${name}`,
          },
        ],
      });
      expect(release?.downloads[0]).toMatchObject({
        platform: "linux",
        arch,
        kind: "portable",
        format: "elf",
      });
    },
  );
  it.each([
    "__proto__",
    "constructor",
    "i686-unknown-linux-gnu",
    "x86_64-pc-windows-msvc",
  ])("rejects an unsupported target %s", (target) => {
    expect(() => linuxExecutableName(target, "0.1.1")).toThrow(
      "Unsupported Linux target",
    );
  });
  it.each(["../../1.0.0", "0.1.1-beta.1", "01.1.1", "v0.1.1"])(
    "rejects unsafe version %s",
    (version) => {
      expect(() =>
        linuxExecutableName("x86_64-unknown-linux-gnu", version),
      ).toThrow("Invalid stable version");
    },
  );
  it("rejects the wrong machine architecture before staging", async () => {
    const f = await fixture("arm64");
    await expect(
      stageLinuxExecutable(
        "x86_64-unknown-linux-gnu",
        f.release,
        f.destination,
        "0.1.1",
        f.root,
      ),
    ).rejects.toThrow("architecture");
  });
  it.each([1, 2])(
    "rejects an AppImage v%s runtime disguised as a native executable",
    async (version) => {
      const f = await fixture();
      const bytes = linuxExecutableFixture("x64");
      bytes.set([0x41, 0x49, version], 8);
      await writeFile(f.binary, bytes);
      await expect(validateLinuxExecutable(f.binary, "x64")).rejects.toThrow(
        "AppImage",
      );
    },
  );
  it.each(["archive", "truncated", "32-bit", "big-endian", "object file"])(
    "rejects a %s instead of an executable",
    async (kind) => {
      const f = await fixture();
      let bytes = linuxExecutableFixture("x64");
      if (kind === "archive") bytes.write("PK", 0);
      if (kind === "truncated") bytes = bytes.subarray(0, 32);
      if (kind === "32-bit") bytes[4] = 1;
      if (kind === "big-endian") bytes[5] = 2;
      if (kind === "object file") bytes.writeUInt16LE(1, 16);
      await writeFile(f.binary, bytes);
      await expect(validateLinuxExecutable(f.binary, "x64")).rejects.toThrow();
    },
  );
  it.each(["tauri.conf.json", "tauri.linux.conf.json"])(
    "refuses to omit new resources from %s",
    async (config) => {
      const f = await fixture();
      await writeFile(
        join(f.root, "src-tauri", config),
        JSON.stringify({
          bundle: { resources: { "../extra.dat": "extra.dat" } },
        }),
      );
      await expect(
        stageLinuxExecutable(
          "x86_64-unknown-linux-gnu",
          f.release,
          f.destination,
          "0.1.1",
          f.root,
        ),
      ).rejects.toThrow("external resources");
    },
  );
  it("refuses to omit a sidecar from a single-file download", async () => {
    const f = await fixture();
    await writeFile(
      join(f.root, "src-tauri", "tauri.linux.conf.json"),
      JSON.stringify({ bundle: { externalBin: ["sidecar"] } }),
    );
    await expect(
      stageLinuxExecutable(
        "x86_64-unknown-linux-gnu",
        f.release,
        f.destination,
        "0.1.1",
        f.root,
      ),
    ).rejects.toThrow("sidecars");
  });
  it("never falls back to another executable or an old AppImage when Legir is missing", async () => {
    const f = await fixture();
    await rm(f.binary);
    await writeFile(join(f.release, "Other"), linuxExecutableFixture("x64"));
    await expect(
      stageLinuxExecutable(
        "x86_64-unknown-linux-gnu",
        f.release,
        f.destination,
        "0.1.1",
        f.root,
      ),
    ).rejects.toThrow();
  });
});
