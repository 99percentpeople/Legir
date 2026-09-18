import { chmod, copyFile, mkdir, open, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export type LinuxArch = "x64" | "arm64";
const linuxTargets: Record<string, LinuxArch> = {
  "x86_64-unknown-linux-gnu": "x64",
  "aarch64-unknown-linux-gnu": "arm64",
};

export function linuxExecutableName(target: string, version: string): string {
  if (!Object.hasOwn(linuxTargets, target)) {
    throw new Error(`Unsupported Linux target: ${target}`);
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Invalid stable version: ${version}`);
  }
  // An extensionless native executable, not an AppImage or an archive.
  return `Legir_${version}_linux_${linuxTargets[target]}_portable`;
}

/** Inspect the executable itself, not just its filename. Never execute an upload. */
export async function validateLinuxExecutable(
  path: string,
  arch: LinuxArch,
): Promise<void> {
  const file = await open(path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size <= 64) {
      throw new Error(`Empty or truncated Linux executable: ${path}`);
    }
    const header = Buffer.alloc(64);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (
      bytesRead !== 64 ||
      header.readUInt32BE(0) !== 0x7f454c46 || // ELF magic
      header[4] !== 2 || // ELFCLASS64
      header[5] !== 1 || // little-endian
      header[6] !== 1 ||
      ![2, 3].includes(header.readUInt16LE(16)) || // executable or PIE
      header.readUInt32LE(20) !== 1 ||
      header.readUInt16LE(52) !== 64
    ) {
      throw new Error(`Expected a native 64-bit Linux ELF executable: ${path}`);
    }
    // AppImage runtimes are also ELF files; reject their magic in EI_PAD.
    if (
      header[8] === 0x41 &&
      header[9] === 0x49 &&
      [1, 2].includes(header[10])
    ) {
      throw new Error(`AppImage is not a native no-install download: ${path}`);
    }
    const machine = header.readUInt16LE(18);
    if (machine !== (arch === "x64" ? 62 : 183)) {
      throw new Error(
        `Linux executable architecture does not match ${arch}: ${path}`,
      );
    }
  } finally {
    await file.close();
  }
}

/** Linux currently embeds its frontend and has no external application resources. */
export async function stageLinuxExecutable(
  target: string,
  releaseDirectory: string,
  destination: string,
  version: string,
  root = projectRoot,
): Promise<string> {
  const name = linuxExecutableName(target, version);
  // Fail closed if future changes require files beside the executable. Do not
  // silently publish an incomplete single-file edition or include system libs.
  for (const name of ["tauri.conf.json", "tauri.linux.conf.json"]) {
    const config = JSON.parse(
      await readFile(join(root, "src-tauri", name), "utf8"),
    );
    for (const value of [
      config.bundle?.resources,
      config.bundle?.externalBin,
    ]) {
      if (
        value !== undefined &&
        (value === null ||
          typeof value !== "object" ||
          Object.keys(value).length > 0)
      ) {
        throw new Error(
          "Single-file Linux downloads cannot omit external resources or sidecars",
        );
      }
    }
  }
  const source = join(releaseDirectory, "Legir");
  await validateLinuxExecutable(source, linuxTargets[target]);
  const output = resolve(destination, name);
  await mkdir(destination, { recursive: true });
  await copyFile(source, output);
  await chmod(output, 0o755);
  console.log(`Staged native Linux executable: ${output}`);
  return output;
}
