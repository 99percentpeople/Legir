import { useEffect, useState } from "react";
import { ArrowUpRight, Download } from "lucide-react";
import { SystemIcon } from "./SystemIcon";
import type { DownloadCopy } from "../content/downloads";
import {
  detectDesktopPlatform,
  formatDownloadSize,
  LATEST_RELEASE_API,
  parseDesktopRelease,
  RELEASES_URL,
  type DesktopPlatform,
  type DesktopRelease,
} from "../lib/downloads";
import "./downloads.css";

type ReleaseState =
  | { status: "loading" | "unpublished" | "error"; release?: never }
  | { status: "ready"; release: DesktopRelease };

const formatOrder = ["exe", "dmg", "deb", "zip", "tar.gz", "AppImage"];

const platforms = [
  { id: "windows", name: "Windows", note: "windowsNote" },
  { id: "macos", name: "macOS", note: "macosNote" },
  { id: "linux", name: "Linux", note: "linuxNote" },
] as const satisfies ReadonlyArray<{
  id: DesktopPlatform;
  name: string;
  note: keyof DownloadCopy;
}>;

export function DownloadSection({ copy }: { copy: DownloadCopy }) {
  const [state, setState] = useState<ReleaseState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [currentPlatform] = useState(() =>
    typeof navigator === "undefined"
      ? null
      : detectDesktopPlatform(navigator.userAgent, navigator.maxTouchPoints),
  );

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 8000);

    async function loadRelease() {
      try {
        const response = await fetch(LATEST_RELEASE_API, {
          headers: { Accept: "application/vnd.github+json" },
          signal: controller.signal,
        });
        if (!active) return;
        if (response.status === 404) {
          setState({ status: "unpublished" });
          return;
        }
        if (!response.ok)
          throw new Error(`Release request failed: ${response.status}`);
        const release = parseDesktopRelease(await response.json());
        if (!release) throw new Error("Invalid desktop release metadata");
        if (active) setState({ status: "ready", release });
      } catch {
        if (active) setState({ status: "error" });
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void loadRelease();
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  const release = state.release;
  const statusText =
    state.status === "loading"
      ? copy.loading
      : state.status === "unpublished"
        ? copy.unpublished
        : state.status === "error"
          ? copy.unavailable
          : `${release?.version} · ${copy.chooseArch}`;

  return (
    <section
      id="downloads"
      className="downloads-section site-container"
      aria-labelledby="downloads-title"
    >
      <div className="downloads-heading">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h2 id="downloads-title">{copy.title}</h2>
        <p>{copy.description}</p>
      </div>
      <div className="downloads-status">
        <p role="status" aria-live="polite">
          {statusText}
        </p>
        {state.status === "error" && (
          <button
            type="button"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((value) => value + 1);
            }}
          >
            {copy.retry}
          </button>
        )}
      </div>
      <div className="download-grid" aria-busy={state.status === "loading"}>
        {platforms.map(({ id, name, note }) => {
          const downloads =
            release?.downloads.filter((item) => item.platform === id) ?? [];
          return (
            <article
              className="download-card"
              data-current={currentPlatform === id}
              key={id}
            >
              <div className="download-card-heading">
                <SystemIcon platform={id} className="download-platform-icon" />
                <h3>{name}</h3>
                {currentPlatform === id && <span>{copy.current}</span>}
              </div>
              <p className="download-platform-note">{copy[note]}</p>
              {downloads.length > 0 ? (
                <ul className="download-options">
                  {(id === "macos" ? ["arm64", "x64"] : ["x64", "arm64"]).map(
                    (arch) => {
                      const installers = downloads
                        .filter((item) => item.arch === arch)
                        .sort(
                          (a, b) =>
                            formatOrder.indexOf(a.format) -
                            formatOrder.indexOf(b.format),
                        );
                      if (!installers.length) return null;
                      return (
                        <li key={arch}>
                          <p className="download-architecture">
                            {id === "macos"
                              ? arch === "arm64"
                                ? "Apple Silicon"
                                : "Intel"
                              : arch === "arm64"
                                ? "ARM64"
                                : "x64"}
                          </p>
                          <div className="download-format-grid">
                            {installers.map((item) => (
                              <a
                                key={item.name}
                                href={item.url}
                                aria-label={`${copy.cta} · ${name} · ${item.arch} · ${copy[item.kind]} · ${item.format}`}
                                data-kind={item.kind}
                              >
                                <Download size={13} aria-hidden="true" />
                                <span>
                                  {copy[item.kind]}
                                  <small>
                                    {item.format === "AppImage"
                                      ? item.format
                                      : item.format.toUpperCase()}
                                    {" · "}
                                    {formatDownloadSize(item.size)}
                                  </small>
                                </span>
                              </a>
                            ))}
                          </div>
                        </li>
                      );
                    },
                  )}
                </ul>
              ) : release ? (
                <p className="download-missing">{copy.missing}</p>
              ) : null}
            </article>
          );
        })}
      </div>
      <div className="downloads-footer">
        <p>
          {copy.signingNote} {copy.portableNote}
        </p>
        <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
          {copy.releases}
          <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
