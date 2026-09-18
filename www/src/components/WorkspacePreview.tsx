import { useId, useRef, useState, type KeyboardEvent } from "react";
import {
  BookOpen,
  Highlighter,
  Languages,
  ListTodo,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import {
  PREVIEW_MODES,
  type LandingCopy,
  type PreviewMode,
} from "../content/types";
import { getDemoCopy } from "./workspace-demo/copy";
import { WorkspaceDemo } from "./workspace-demo/WorkspaceDemo";

const MODE_ICONS = {
  read: BookOpen,
  annotate: Highlighter,
  forms: ListTodo,
  ai: Sparkles,
  translate: Languages,
};
type PreviewProps = { copy: LandingCopy["preview"]; language: string };
export function WorkspacePreview({ copy, language }: PreviewProps) {
  const [mode, setMode] = useState<PreviewMode>("read");
  const [generation, setGeneration] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const demoCopy = getDemoCopy(language);
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
    setMode(PREVIEW_MODES[next]);
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
              onClick={() => setMode(value)}
              onKeyDown={(event) => handleTabKey(event, index)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{copy.modes[value]}</span>
            </button>
          );
        })}
      </div>
      <div
        className="workspace-frame"
        data-mode={mode}
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${mode}`}
        aria-describedby={`${id}-caption`}
        tabIndex={0}
      >
        <WorkspaceDemo
          key={`${language}-${generation}`}
          mode={mode}
          language={language}
          appLabel={copy.appLabel}
        />
      </div>
      <div className="preview-footer">
        <p className="preview-caption" id={`${id}-caption`}>
          {copy.caption}
        </p>
        <button
          type="button"
          className="preview-reset"
          onClick={() => {
            setMode("read");
            setGeneration((previous) => previous + 1);
          }}
        >
          <RotateCcw size={13} aria-hidden="true" />
          {demoCopy.reset}
        </button>
      </div>
    </section>
  );
}
