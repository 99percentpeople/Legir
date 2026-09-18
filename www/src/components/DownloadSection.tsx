import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { DownloadCard } from "./DownloadCard";
import type { DownloadCopy } from "../content/downloads";
import {
  detectDesktopPlatform,
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
  // Put the current system first in the DOM for keyboard and mobile users.
  // CSS places that same card in the center column on wide screens.
  const orderedPlatforms = currentPlatform
    ? [
        ...platforms.filter((platform) => platform.id === currentPlatform),
        ...platforms.filter((platform) => platform.id !== currentPlatform),
      ]
    : platforms;
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
      <div
        className="download-grid"
        data-has-current={currentPlatform !== null}
        aria-busy={state.status === "loading"}
      >
        {orderedPlatforms.map(({ id, name, note }, index) => (
          <DownloadCard
            key={id}
            platform={id}
            name={name}
            note={copy[note]}
            current={currentPlatform === id}
            position={
              currentPlatform
                ? index === 0
                  ? "center"
                  : index === 1
                    ? "left"
                    : "right"
                : undefined
            }
            downloads={
              release?.downloads.filter((item) => item.platform === id) ?? []
            }
            hasRelease={Boolean(release)}
            copy={copy}
          />
        ))}
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
