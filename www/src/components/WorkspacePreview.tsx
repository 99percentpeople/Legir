import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import {
  BookOpen,
  Highlighter,
  Languages,
  LayoutGrid,
  ListTodo,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import {
  PREVIEW_MODES,
  type LandingCopy,
  type PreviewMode,
} from "../content/types";
import { getDemoCopy } from "./workspace-demo/copy";
import { WorkspaceScreenshot } from "./WorkspaceScreenshot";
import { Button } from "@/components/ui/button";

const WorkspaceDemo = lazy(() =>
  import("./workspace-demo/WorkspaceDemo").then((module) => ({
    default: module.WorkspaceDemo,
  })),
);

const STATIC_PREVIEW_QUERY =
  "(max-width: 767px), (hover: none) and (pointer: coarse)";
const isStaticPreview = () => window.matchMedia(STATIC_PREVIEW_QUERY).matches;
function subscribeViewport(onChange: () => void) {
  const media = window.matchMedia(STATIC_PREVIEW_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

const MODE_ICONS = {
  read: BookOpen,
  annotate: Highlighter,
  forms: ListTodo,
  ai: Sparkles,
  translate: Languages,
  pages: LayoutGrid,
};
type PreviewProps = { copy: LandingCopy["preview"]; language: string };
export function WorkspacePreview({ copy, language }: PreviewProps) {
  const mobile = useSyncExternalStore(subscribeViewport, isStaticPreview);
  const [mode, setMode] = useState<PreviewMode>("read");
  const [generation, setGeneration] = useState(0);
  const [playing, setPlaying] = useState(
    () => !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const demoCopy = getDemoCopy(language);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const update = () => {
      if (media?.matches) setPlaying(false);
    };
    media?.addEventListener?.("change", update);
    return () => media?.removeEventListener?.("change", update);
  }, []);
  function chooseMode(value: PreviewMode) {
    setMode(value);
    setPlaying(
      !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    );
  }
  function handleTabKey(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % PREVIEW_MODES.length;
    else if (event.key === "ArrowLeft")
      next = (index + PREVIEW_MODES.length - 1) % PREVIEW_MODES.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = PREVIEW_MODES.length - 1;
    else return;
    event.preventDefault();
    chooseMode(PREVIEW_MODES[next]);
    tabs.current[next]?.focus();
  }
  return (
    <section
      className="workspace-section site-container"
      aria-labelledby={`${id}-title`}
    >
      <h2 id={`${id}-title`} className="sr-only">
        {copy.label}
      </h2>
      <div className="preview-controls">
        <div className="preview-tabs" role="tablist" aria-label={copy.label}>
          {PREVIEW_MODES.map((value, index) => {
            const Icon = MODE_ICONS[value];
            return (
              <button
                key={value}
                ref={(element) => {
                  tabs.current[index] = element;
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${value}`}
                aria-controls={`${id}-panel`}
                aria-selected={mode === value}
                tabIndex={mode === value ? 0 : -1}
                onClick={() => chooseMode(value)}
                onKeyDown={(event) => handleTabKey(event, index)}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{copy.modes[value]}</span>
              </button>
            );
          })}
        </div>
        {!mobile && (
          <div className="preview-playback-controls">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="preview-playback"
              title={playing ? demoCopy.pause : demoCopy.play}
              aria-label={playing ? demoCopy.pause : demoCopy.play}
              aria-pressed={playing}
              onClick={() => setPlaying((value) => !value)}
            >
              {playing ? (
                <Pause size={16} aria-hidden="true" />
              ) : (
                <Play size={16} aria-hidden="true" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="preview-reset"
              title={demoCopy.reset}
              aria-label={demoCopy.reset}
              onClick={() => {
                setMode("read");
                setPlaying(
                  !window.matchMedia?.("(prefers-reduced-motion: reduce)")
                    .matches,
                );
                setGeneration((previous) => previous + 1);
              }}
            >
              <RotateCcw size={16} aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
      <div
        className="workspace-frame"
        data-mode={mode}
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${mode}`}
        tabIndex={0}
      >
        {mobile ? (
          <WorkspaceScreenshot
            language={language}
            mode={mode}
            label={`${copy.label} — ${copy.modes[mode]}`}
          />
        ) : (
          <Suspense
            fallback={
              <WorkspaceScreenshot
                language={language}
                mode={mode}
                label={`${copy.label} — ${copy.modes[mode]}`}
              />
            }
          >
            <WorkspaceDemo
              key={`${language}-${generation}`}
              mode={mode}
              language={language}
              appLabel={copy.appLabel}
              onModeChange={setMode}
              autoplay={playing}
              onPause={() => setPlaying(false)}
            />
          </Suspense>
        )}
      </div>
    </section>
  );
}
