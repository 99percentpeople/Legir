// @vitest-environment node
import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPortableArchive,
  portableArchiveName,
  stageWindowsPortable,
} from "../scripts/desktop-portable";
import { parseDesktopRelease, RELEASES_URL } from "../www/src/lib/downloads";

const execFileAsync = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "legir-portable-test-"));
  directories.push(directory);
  return directory;
}

async function windowsFixture() {
  const root = await temporaryDirectory();
  const release = join(root, "release");
  await mkdir(release);
  await mkdir(join(root, "src-tauri"));
  await mkdir(join(root, "generated-icons", "pdf"), { recursive: true });
  await writeFile(join(root, "LICENSE"), "License fixture");
  await writeFile(
    join(root, "src-tauri", "tauri.conf.json"),
    JSON.stringify({ bundle: {} }),
  );
  await writeFile(
    join(root, "src-tauri", "tauri.windows.conf.json"),
    JSON.stringify({
      bundle: {
        resources: { "../generated-icons/pdf/icon.ico": "pdf-document.ico" },
      },
    }),
  );
  await writeFile(
    join(root, "generated-icons", "pdf", "icon.ico"),
    "PDF icon fixture",
  );
  await writeFile(join(release, "Legir.exe"), "MZ executable fixture");
  await writeFile(join(release, "WebView2Loader.dll"), "DLL fixture");
  await writeFile(join(release, "Legir.pdb"), "Do not ship debug symbols");
  await writeFile(
    join(release, "unrelated.exe"),
    "Do not guess the first executable",
  );
  return { root, release, output: join(root, "portable") };
}

describe("portable package naming and contents", () => {
  it.each([
    [
      "x86_64-pc-windows-msvc",
      "Legir_0.1.0_windows_x64_portable.zip",
      "windows",
      "x64",
    ],
    [
      "x86_64-apple-darwin",
      "Legir_0.1.0_macos_x64_portable.tar.gz",
      "macos",
      "x64",
    ],
    [
      "aarch64-apple-darwin",
      "Legir_0.1.0_macos_arm64_portable.tar.gz",
      "macos",
      "arm64",
    ],
  ])(
    "uses a website-recognized name for %s",
    (target, name, platform, arch) => {
      expect(portableArchiveName(target, "0.1.0")).toBe(name);
      const parsed = parseDesktopRelease({
        draft: false,
        prerelease: false,
        tag_name: "v0.1.0",
        assets: [
          {
            name,
            size: 123,
            state: "uploaded",
            browser_download_url: `${RELEASES_URL}/download/v0.1.0/${name}`,
          },
        ],
      });
      expect(parsed?.downloads).toHaveLength(1);
      expect(parsed?.downloads[0]).toMatchObject({
        platform,
        arch,
        kind: "portable",
      });
    },
  );
  it("rejects unsupported targets and versions", () => {
    expect(() =>
      portableArchiveName("aarch64-unknown-linux-gnu", "0.1.0"),
    ).toThrow("AppImage");
    expect(() => portableArchiveName("__proto__", "0.1.0")).toThrow(
      "Unsupported",
    );
    expect(() =>
      portableArchiveName("x86_64-pc-windows-msvc", "../../0.1.0"),
    ).toThrow("Invalid stable version");
  });
  it("stages the exact Windows binary, DLLs, configured resources, license and usage notes", async () => {
    const { root, release, output } = await windowsFixture();
    await stageWindowsPortable(release, output, root);
    expect((await readdir(output)).sort()).toEqual(
      [
        "LICENSE.txt",
        "Legir.exe",
        "README.txt",
        "WebView2Loader.dll",
        "pdf-document.ico",
      ].sort(),
    );
    expect(await readFile(join(output, "pdf-document.ico"), "utf8")).toBe(
      "PDF icon fixture",
    );
    expect(await readFile(join(output, "Legir.exe"), "utf8")).toBe(
      "MZ executable fixture",
    );
    const readme = await readFile(join(output, "README.txt"), "utf8");
    expect(readme).toContain("WebView2 Runtime must already be installed");
    expect(readme).toContain("not a self-contained portable user profile");
  });
  it("fails for missing Windows resources instead of producing an incomplete package", async () => {
    const { root, release, output } = await windowsFixture();
    await rm(join(root, "generated-icons", "pdf", "icon.ico"));
    await expect(stageWindowsPortable(release, output, root)).rejects.toThrow();
  });
  it("rejects resource destinations outside the portable directory", async () => {
    const { root, release, output } = await windowsFixture();
    await writeFile(
      join(root, "src-tauri", "tauri.windows.conf.json"),
      JSON.stringify({
        bundle: {
          resources: { "../generated-icons/pdf/icon.ico": "../escaped.ico" },
        },
      }),
    );
    await expect(stageWindowsPortable(release, output, root)).rejects.toThrow(
      "escapes",
    );
  });
  it("requires an explicit staging decision for new sidecars", async () => {
    const { root, release, output } = await windowsFixture();
    await writeFile(
      join(root, "src-tauri", "tauri.conf.json"),
      JSON.stringify({ bundle: { externalBin: ["bin/helper"] } }),
    );
    await expect(stageWindowsPortable(release, output, root)).rejects.toThrow(
      "sidecar",
    );
  });
  it.skipIf(process.platform === "win32")(
    "archives a complete macOS app with its executable permissions, symlinks and signature files",
    async () => {
      const directory = await temporaryDirectory();
      const release = join(directory, "release");
      const contents = join(
        release,
        "bundle",
        "macos",
        "Legir.app",
        "Contents",
      );
      await mkdir(join(contents, "MacOS"), { recursive: true });
      await mkdir(join(contents, "Resources"));
      await mkdir(join(contents, "_CodeSignature"));
      await writeFile(join(contents, "Info.plist"), "plist fixture");
      await writeFile(join(contents, "MacOS", "Legir"), "executable fixture");
      await chmod(join(contents, "MacOS", "Legir"), 0o755);
      await writeFile(
        join(contents, "Resources", "asset.dat"),
        "resource fixture",
      );
      await symlink("asset.dat", join(contents, "Resources", "alias.dat"));
      await writeFile(
        join(contents, "_CodeSignature", "CodeResources"),
        "signature fixture",
      );
      const output = await createPortableArchive(
        "aarch64-apple-darwin",
        release,
        join(directory, "out"),
        "0.1.0",
      );
      expect((await stat(output)).size).toBeGreaterThan(0);
      const extracted = join(directory, "extracted");
      await mkdir(extracted);
      await execFileAsync("tar", ["-xzf", output, "-C", extracted]);
      const app = join(extracted, "Legir.app", "Contents");
      expect((await stat(join(app, "MacOS", "Legir"))).mode & 0o777).toBe(
        0o755,
      );
      expect(
        await readFile(join(app, "_CodeSignature", "CodeResources"), "utf8"),
      ).toBe("signature fixture");
      expect(
        (await lstat(join(app, "Resources", "alias.dat"))).isSymbolicLink(),
      ).toBe(true);
      expect(await readlink(join(app, "Resources", "alias.dat"))).toBe(
        "asset.dat",
      );
      expect(await readFile(join(extracted, "README.txt"), "utf8")).toContain(
        "normal per-user app data location",
      );
      expect(await readFile(join(extracted, "LICENSE.txt"), "utf8")).toContain(
        "GNU AFFERO GENERAL PUBLIC LICENSE",
      );
    },
  );
  it("rejects an incomplete macOS bundle", async () => {
    const directory = await temporaryDirectory();
    await expect(
      createPortableArchive(
        "x86_64-apple-darwin",
        join(directory, "missing"),
        join(directory, "out"),
        "0.1.0",
      ),
    ).rejects.toThrow();
  });
});
