import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDesktopRelease, RELEASES_URL } from "../www/src/lib/downloads";
import { validateLinuxExecutable, type LinuxArch } from "./desktop-linux";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function validateDesktopVersions(
  packageVersion: string,
  tauriVersion: string,
  cargoManifest: string,
  tag?: string,
): string {
  const packageSection = cargoManifest.match(
    /^\[package\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m,
  )?.[1];
  const cargoVersion = packageSection?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (
    !stableVersion.test(tauriVersion) ||
    packageVersion !== tauriVersion ||
    cargoVersion !== tauriVersion
  ) {
    throw new Error(
      `Desktop versions must match: package.json=${packageVersion}, tauri.conf.json=${tauriVersion}, Cargo.toml=${cargoVersion ?? "missing"}`,
    );
  }
  if (tag !== undefined && tag !== `v${tauriVersion}`) {
    throw new Error(`Release tag must be v${tauriVersion}, received ${tag}`);
  }
  return tauriVersion;
}

export async function readDesktopVersion(tag?: string): Promise<string> {
  const [packageText, tauriText, cargoText] = await Promise.all([
    readFile(resolve(projectRoot, "package.json"), "utf8"),
    readFile(resolve(projectRoot, "src-tauri/tauri.conf.json"), "utf8"),
    readFile(resolve(projectRoot, "src-tauri/Cargo.toml"), "utf8"),
  ]);
  return validateDesktopVersions(
    JSON.parse(packageText).version,
    JSON.parse(tauriText).version,
    cargoText,
    tag,
  );
}

// Exactly one installer and one no-install package for each supported target.
// The publication gate and landing page use the same asset-name parser.
export const REQUIRED_DOWNLOADS = [
  "windows/x64/exe",
  "windows/x64/zip",
  "macos/x64/dmg",
  "macos/x64/tar.gz",
  "macos/arm64/dmg",
  "macos/arm64/tar.gz",
  "linux/x64/deb",
  "linux/x64/elf",
  "linux/arm64/deb",
  "linux/arm64/elf",
] as const;

export function validateReleaseAssets(
  version: string,
  files: Array<{ name: string; size: number }>,
): void {
  const versionPattern = new RegExp(
    `[_-]${version.replaceAll(".", "\\.")}[_-]`,
  );
  if (files.some((file) => !versionPattern.test(file.name))) {
    throw new Error("Every download filename must include the release version");
  }
  const release = parseDesktopRelease({
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: files.map((file) => ({
      ...file,
      state: "uploaded",
      browser_download_url: `${RELEASES_URL}/download/v${version}/${encodeURIComponent(file.name)}`,
    })),
  });
  if (!release || release.downloads.length !== files.length) {
    throw new Error(
      "Release contains empty, duplicate or unrecognized downloads",
    );
  }
  const present = new Set(
    release.downloads.map(
      (file) => `${file.platform}/${file.arch}/${file.format}`,
    ),
  );
  const missing = REQUIRED_DOWNLOADS.filter((key) => !present.has(key));
  if (missing.length)
    throw new Error(`Missing downloads: ${missing.join(", ")}`);
  if (present.size !== REQUIRED_DOWNLOADS.length)
    throw new Error("Release contains unsupported download variants");
}

/** Flatten bundle subdirectories before Actions uploads them. Never ship .app internals. */
export async function stageInstallers(
  bundleDirectory: string,
  destination: string,
): Promise<void> {
  await mkdir(destination, { recursive: true });
  const names = new Set<string>();
  // Ignore stale MSI/RPM/AppImage outputs in local or cached build directories.
  for (const kind of ["nsis", "dmg", "deb"]) {
    const source = resolve(bundleDirectory, kind);
    const entries = await readdir(source, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(exe|dmg|deb)$/.test(entry.name)) continue;
      if (names.has(entry.name))
        throw new Error(`Duplicate installer: ${entry.name}`);
      names.add(entry.name);
      await copyFile(
        resolve(source, entry.name),
        resolve(destination, entry.name),
      );
    }
  }
  if (!names.size) throw new Error(`No installers found in ${bundleDirectory}`);
  console.log(`Staged ${names.size} installers in ${destination}`);
}

export async function prepareRelease(
  directory: string,
  version: string,
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name !== "SHA256SUMS.txt")
      .map(async (entry) => ({
        name: entry.name,
        size: (await stat(resolve(directory, entry.name))).size,
      })),
  );
  files.sort((a, b) => a.name.localeCompare(b.name));
  validateReleaseAssets(version, files);
  // Recheck binary identity after the per-platform Actions artifacts are merged.
  // Actions downloads do not retain executable mode; restore it only after validation.
  for (const file of files) {
    const arch = file.name
      .match(/_linux_(x64|arm64)_portable$/i)?.[1]
      .toLowerCase() as LinuxArch | undefined;
    if (arch) {
      const path = resolve(directory, file.name);
      await validateLinuxExecutable(path, arch);
      await chmod(path, 0o755);
    }
  }
  const checksums: string[] = [];
  for (const file of files) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(resolve(directory, file.name)))
      hash.update(chunk);
    checksums.push(`${hash.digest("hex")}  ${file.name}`);
  }
  await writeFile(
    resolve(directory, "SHA256SUMS.txt"),
    `${checksums.join("\n")}\n`,
  );
  console.log(
    `Validated ${files.length} downloads for v${version}; wrote SHA256SUMS.txt`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [command, argument, destination] = process.argv.slice(2);
    if (command === "check")
      console.log(`Desktop version: ${await readDesktopVersion(argument)}`);
    else if (command === "prepare" && argument)
      await prepareRelease(resolve(argument), await readDesktopVersion());
    else if (command === "stage" && argument && destination)
      await stageInstallers(resolve(argument), resolve(destination));
    else
      throw new Error(
        "Usage: bun scripts/desktop-release.ts check [vX.Y.Z] | stage <bundle-directory> <destination> | prepare <directory>",
      );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
