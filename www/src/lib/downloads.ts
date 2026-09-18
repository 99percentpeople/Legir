import { SOURCE_URL } from "./app-url";

export const RELEASES_URL = `${SOURCE_URL}/releases`;
export const LATEST_RELEASE_API =
  "https://api.github.com/repos/99percentpeople/Legir/releases/latest";

export type DesktopPlatform = "windows" | "macos" | "linux";
export type DownloadFormat =
  | "exe"
  | "dmg"
  | "deb"
  | "AppImage"
  | "zip"
  | "tar.gz";
export type DownloadKind = "installer" | "portable";
export interface DesktopDownload {
  name: string;
  url: string;
  size: number;
  platform: DesktopPlatform;
  arch: "x64" | "arm64";
  format: DownloadFormat;
  kind: DownloadKind;
}
export interface DesktopRelease {
  version: string;
  url: string;
  downloads: DesktopDownload[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Accept only supported installers/portable packages from this repository. */
export function parseDesktopRelease(value: unknown): DesktopRelease | null {
  if (
    !isRecord(value) ||
    value.draft !== false ||
    value.prerelease !== false ||
    typeof value.tag_name !== "string" ||
    !/^v\d+\.\d+\.\d+$/.test(value.tag_name) ||
    !Array.isArray(value.assets)
  ) {
    return null;
  }

  const prefix = `${RELEASES_URL}/download/${value.tag_name}/`;
  const downloads: DesktopDownload[] = [];
  for (const asset of value.assets) {
    if (
      !isRecord(asset) ||
      asset.state !== "uploaded" ||
      typeof asset.name !== "string" ||
      typeof asset.browser_download_url !== "string" ||
      asset.browser_download_url !==
        `${prefix}${encodeURIComponent(asset.name)}` ||
      typeof asset.size !== "number" ||
      !Number.isFinite(asset.size) ||
      asset.size <= 0
    ) {
      continue;
    }
    const name = asset.name;
    // Recognize Tauri's normal bundle names, including Debian's amd64/arm64.
    const arch = /(?:^|[_\-.])(aarch64|arm64)(?=[_\-.]|$)/i.test(name)
      ? "arm64"
      : /(?:^|[_\-.])(x86_64|x64|amd64)(?=[_\-.]|$)/i.test(name)
        ? "x64"
        : null;
    const version = value.tag_name.slice(1).replaceAll(".", "\\.");
    if (!arch || !new RegExp(`^legir_${version}_`, "i").test(name)) continue;
    const extension = name.match(/\.(exe|dmg|deb|AppImage|zip|tar\.gz)$/i)?.[1];
    if (!extension) continue;
    const format = (
      extension.toLowerCase() === "appimage"
        ? "AppImage"
        : extension.toLowerCase()
    ) as DownloadFormat;
    let platform: DesktopPlatform;
    if (format === "zip") {
      // A generic ZIP might be source code or updater data, not a portable app.
      if (
        !new RegExp(`^Legir_${version}_windows_x64_portable\\.zip$`, "i").test(
          name,
        )
      )
        continue;
      platform = "windows";
    } else if (format === "tar.gz") {
      if (
        !new RegExp(
          `^Legir_${version}_macos_(x64|arm64)_portable\\.tar\\.gz$`,
          "i",
        ).test(name)
      )
        continue;
      platform = "macos";
    } else if (format === "exe") {
      // Only x64 NSIS installers are shipped; a loose .exe is not an installer.
      if (!new RegExp(`^Legir_${version}_x64-setup\\.exe$`, "i").test(name))
        continue;
      platform = "windows";
    } else {
      platform = format === "dmg" ? "macos" : "linux";
    }
    const kind: DownloadKind =
      format === "AppImage" || format === "zip" || format === "tar.gz"
        ? "portable"
        : "installer";
    if (
      downloads.some(
        (item) =>
          item.platform === platform &&
          item.arch === arch &&
          item.format === format,
      )
    ) {
      continue;
    }
    downloads.push({
      name,
      url: asset.browser_download_url,
      size: asset.size,
      platform,
      arch,
      format,
      kind,
    });
  }

  return {
    version: value.tag_name,
    url: `${RELEASES_URL}/tag/${value.tag_name}`,
    downloads: downloads.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Detect the OS only: browsers cannot reliably distinguish Intel/Apple Silicon. */
export function detectDesktopPlatform(
  userAgent: string,
  maxTouchPoints = 0,
): DesktopPlatform | null {
  if (/Android|iPhone|iPad|iPod/i.test(userAgent)) return null;
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return null;
  if (/Windows/i.test(userAgent)) return "windows";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "macos";
  if (/Linux/i.test(userAgent) && !/CrOS/i.test(userAgent)) return "linux";
  return null;
}

export function formatDownloadSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
