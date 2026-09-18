import { Download } from "lucide-react";
import type { DownloadCopy } from "../content/downloads";
import {
  formatDownloadSize,
  type DesktopDownload,
  type DesktopPlatform,
} from "../lib/downloads";
import { SystemIcon } from "./SystemIcon";

interface DownloadCardProps {
  platform: DesktopPlatform;
  name: string;
  note: string;
  current: boolean;
  position?: "center" | "left" | "right";
  downloads: DesktopDownload[];
  hasRelease: boolean;
  copy: DownloadCopy;
}

export function DownloadCard({
  platform,
  name,
  note,
  current,
  position,
  downloads,
  hasRelease,
  copy,
}: DownloadCardProps) {
  const titleId = `download-${platform}-title`;
  const linuxNoteId = `download-${platform}-portable-note`;
  // Do not infer processor architecture from the OS. Keep every published choice.
  const architectures =
    platform === "macos" ? ["arm64", "x64"] : ["x64", "arm64"];

  return (
    <article
      className="download-card"
      data-platform={platform}
      data-current={current}
      data-position={position}
      aria-labelledby={titleId}
    >
      {current && <p className="download-current-badge">{copy.current}</p>}
      <div className="download-card-heading">
        <SystemIcon
          platform={platform}
          size={current ? 44 : 28}
          className="download-platform-icon"
        />
        <h3 id={titleId}>{name}</h3>
      </div>
      <p className="download-platform-note">{note}</p>
      {downloads.length > 0 ? (
        <ul className="download-options">
          {architectures.map((arch) => {
            const files = downloads
              .filter((item) => item.arch === arch)
              .sort(
                (a, b) =>
                  Number(a.kind === "portable") - Number(b.kind === "portable"),
              );
            if (!files.length) return null;
            return (
              <li key={arch} data-arch={arch}>
                <p className="download-architecture">
                  {platform === "macos"
                    ? arch === "arm64"
                      ? "Apple Silicon"
                      : "Intel"
                    : arch === "arm64"
                      ? "ARM64"
                      : "x64"}
                </p>
                <div className="download-file-links">
                  {files.map((item) => {
                    const installer = item.kind === "installer";
                    const format = item.format.toUpperCase();
                    return (
                      <a
                        key={item.name}
                        className={
                          installer ? "download-installer" : "download-portable"
                        }
                        href={item.url}
                        aria-label={`${installer ? copy.downloadInstaller : copy.portable} · ${name} · ${item.arch} · ${format}`}
                        data-kind={item.kind}
                        aria-describedby={
                          item.format === "elf" ? linuxNoteId : undefined
                        }
                      >
                        {installer ? (
                          <>
                            <span>
                              {copy.downloadInstaller}
                              <small>
                                {format} · {formatDownloadSize(item.size)}
                              </small>
                            </span>
                            <Download size={17} aria-hidden="true" />
                          </>
                        ) : (
                          <>
                            <span>{copy.portable}</span>
                            <small>
                              {format} · {formatDownloadSize(item.size)}
                            </small>
                          </>
                        )}
                      </a>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      ) : hasRelease ? (
        <p className="download-missing">{copy.missing}</p>
      ) : null}
      {downloads.some((item) => item.format === "elf") && (
        <p id={linuxNoteId} className="download-platform-note">
          {copy.linuxPortableNote}
        </p>
      )}
    </article>
  );
}
