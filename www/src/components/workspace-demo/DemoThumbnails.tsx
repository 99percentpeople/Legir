import { useEffect, useRef, type CSSProperties, type Dispatch } from "react";
import { useLanguage } from "@/components/language-provider";
import { DemoDocumentContent } from "./DemoDocumentContent";
import { useDemoViewport } from "./useDemoViewport";
import { PAPER_WIDTH } from "./geometry";
import { PAGE_TITLES, type DemoAction, type DemoState } from "./types";
import type { DemoCopy } from "./copy";

function DemoThumbnail({
  page,
  state,
  copy,
  dispatch,
}: {
  page: number;
  state: DemoState;
  copy: DemoCopy;
  dispatch: Dispatch<DemoAction>;
}) {
  const { t } = useLanguage();
  const frame = useRef<HTMLDivElement>(null);
  const { width } = useDemoViewport(frame);
  return (
    <button
      className="demo-thumbnail"
      type="button"
      aria-label={t("sidebar.page", { page })}
      aria-current={state.page === page ? "page" : undefined}
      onClick={() => dispatch({ type: "page", page })}
    >
      <div ref={frame} className="demo-mini-paper" aria-hidden="true" inert>
        <div
          className="demo-paper"
          lang="en"
          style={
            {
              "--demo-zoom": width / PAPER_WIDTH,
              "--demo-highlight": state.highlightColor,
            } as CSSProperties
          }
        >
          <DemoDocumentContent
            state={{ ...state, page }}
            copy={copy}
            thumbnail
          />
        </div>
      </div>
      <span>{t("sidebar.page", { page })}</span>
    </button>
  );
}
export function DemoThumbnails(props: {
  state: DemoState;
  copy: DemoCopy;
  dispatch: Dispatch<DemoAction>;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = scroll.current;
    const active = root?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!root || !active) return;
    // Only scroll this list; scrollIntoView also moves the marketing page.
    const viewport = root.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    if (box.top < viewport.top) root.scrollTop += box.top - viewport.top;
    else if (box.bottom > viewport.bottom)
      root.scrollTop += box.bottom - viewport.bottom;
  }, [props.state.page]);
  return (
    <div ref={scroll} className="demo-sidebar-scroll demo-thumbnails">
      {PAGE_TITLES.map((title, index) => (
        <DemoThumbnail key={title} page={index + 1} {...props} />
      ))}
    </div>
  );
}
