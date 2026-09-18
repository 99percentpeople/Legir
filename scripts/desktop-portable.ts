import { execFile } from "node:child_process";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readDesktopVersion } from "./desktop-release";
import { stageLinuxExecutable } from "./desktop-linux";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const portableTargets = {
  "x86_64-pc-windows-msvc": { platform: "windows", arch: "x64", format: "zip" },
  "x86_64-apple-darwin": { platform: "macos", arch: "x64", format: "tar.gz" },
  "aarch64-apple-darwin": {
    platform: "macos",
    arch: "arm64",
    format: "tar.gz",
  },
} as const;

export function portableArchiveName(target: string, version: string): string {
  if (!Object.hasOwn(portableTargets, target)) {
    throw new Error(
      `Unsupported archive target: ${target}. Linux uses an unarchived native executable.`,
    );
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Invalid stable version: ${version}`);
  }
  const { platform, arch, format } =
    portableTargets[target as keyof typeof portableTargets];
  return `Legir_${version}_${platform}_${arch}_portable.${format}`;
}

/** Include the resources shipped by NSIS, plus any adjacent runtime DLLs. */
export async function stageWindowsPortable(
  releaseDirectory: string,
  destination: string,
  root = projectRoot,
): Promise<void> {
  await mkdir(destination, { recursive: true });
  await copyFile(
    join(releaseDirectory, "Legir.exe"),
    join(destination, "Legir.exe"),
  );
  for (const entry of await readdir(releaseDirectory, {
    withFileTypes: true,
  })) {
    if (entry.isFile() && /\.dll$/i.test(entry.name)) {
      await copyFile(
        join(releaseDirectory, entry.name),
        join(destination, entry.name),
      );
    }
  }
  // The current desktop resources use Tauri's explicit source -> destination map.
  // Fail rather than silently omit a newly introduced array/glob or sidecar.
  const resources: Record<string, string> = {};
  for (const name of ["tauri.conf.json", "tauri.windows.conf.json"]) {
    const config = JSON.parse(
      await readFile(join(root, "src-tauri", name), "utf8"),
    );
    const bundle = config.bundle;
    if (bundle?.externalBin?.length)
      throw new Error(
        "Portable sidecar staging must be configured before shipping externalBin",
      );
    if (bundle?.resources !== undefined) {
      if (
        typeof bundle.resources !== "object" ||
        bundle.resources === null ||
        Array.isArray(bundle.resources)
      ) {
        throw new Error(
          "Windows portable resources must use an explicit source/destination map",
        );
      }
      Object.assign(resources, bundle.resources);
    }
  }
  for (const [source, target] of Object.entries(resources)) {
    if (typeof target !== "string" || /[*?[\]{}]/.test(source)) {
      throw new Error(
        "Portable resources require literal source and destination paths",
      );
    }
    const output = resolve(destination, target);
    const local = relative(resolve(destination), output);
    if (
      !local ||
      local === ".." ||
      local.startsWith(`..${sep}`) ||
      isAbsolute(local)
    ) {
      throw new Error(
        `Resource destination escapes the portable directory: ${target}`,
      );
    }
    await mkdir(dirname(output), { recursive: true });
    await cp(resolve(root, "src-tauri", source), output, { recursive: true });
  }
  await copyFile(join(root, "LICENSE"), join(destination, "LICENSE.txt"));
  await writeFile(
    join(destination, "README.txt"),
    [
      "Legir for Windows - no-install edition",
      "",
      "Extract the entire Legir folder and run Legir.exe. Keep all included resources and DLLs beside it.",
      "Microsoft Edge WebView2 Runtime must already be installed. This ZIP does not install a runtime; use the EXE installer if it is missing.",
      "Runtime information: https://developer.microsoft.com/microsoft-edge/webview2/",
      "No installer, shortcuts or PDF file associations are registered by this package.",
      "Settings, API credentials and recent-file history still use the normal per-user app data location, not this folder. This is not a self-contained portable user profile.",
      "Early builds are not Windows code-signed. Review the release notes before running.",
      "",
    ].join("\n"),
  );
}

export async function createPortableArchive(
  target: string,
  releaseDirectory: string,
  destination: string,
  version: string,
): Promise<string> {
  const name = portableArchiveName(target, version);
  const temporary = await mkdtemp(join(tmpdir(), "legir-portable-"));
  const archive = join(temporary, name);
  try {
    if (target.endsWith("windows-msvc")) {
      const directory = join(temporary, "Legir");
      await stageWindowsPortable(releaseDirectory, directory);
      // Use literal paths/environment values, not shell-interpolated checkout paths.
      await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$ErrorActionPreference = 'Stop'; Compress-Archive -LiteralPath $env:LEGIR_PORTABLE_DIRECTORY -DestinationPath $env:LEGIR_PORTABLE_ARCHIVE -CompressionLevel Optimal",
        ],
        {
          env: {
            ...process.env,
            LEGIR_PORTABLE_DIRECTORY: directory,
            LEGIR_PORTABLE_ARCHIVE: archive,
          },
        },
      );
    } else {
      const bundleDirectory = resolve(releaseDirectory, "bundle", "macos");
      for (const required of ["Contents/Info.plist", "Contents/MacOS/Legir"]) {
        const file = await stat(join(bundleDirectory, "Legir.app", required));
        if (!file.isFile() || file.size === 0)
          throw new Error(`Incomplete macOS app bundle: ${required}`);
      }
      await copyFile(
        join(projectRoot, "LICENSE"),
        join(temporary, "LICENSE.txt"),
      );
      await writeFile(
        join(temporary, "README.txt"),
        [
          "Legir for macOS - no-install edition",
          "",
          "Extract the archive and open Legir.app. Keep the complete app bundle intact.",
          "The archive preserves the bundle's resources, permissions, symbolic links and code signature files.",
          "Settings, API credentials and recent-file history still use the normal per-user app data location, not the extracted directory.",
          "Early builds use ad-hoc signing and are not Apple-notarized. Review the release notes before running; do not disable system security globally.",
          "",
        ].join("\n"),
      );
      // Archive the original (already signed) .app, never only Contents/MacOS/Legir.
      await execFileAsync("tar", [
        "-czf",
        archive,
        "-C",
        bundleDirectory,
        "Legir.app",
        "-C",
        temporary,
        "LICENSE.txt",
        "README.txt",
      ]);
    }
    if ((await stat(archive)).size === 0)
      throw new Error("Portable archive is empty");
    await mkdir(destination, { recursive: true });
    const output = resolve(destination, name);
    await copyFile(archive, output);
    console.log(`Created portable package: ${output}`);
    return output;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [target, releaseDirectory, destination] = process.argv.slice(2);
    if (!target || !releaseDirectory || !destination) {
      throw new Error(
        "Usage: bun scripts/desktop-portable.ts <target> <release-directory> <destination>",
      );
    }
    const packageNoInstall = target.endsWith("-unknown-linux-gnu")
      ? stageLinuxExecutable
      : createPortableArchive;
    await packageNoInstall(
      target,
      resolve(releaseDirectory),
      resolve(destination),
      await readDesktopVersion(),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
