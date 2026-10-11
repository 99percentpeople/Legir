import { useEffect, useRef, type Dispatch } from "react";
import { useLanguage } from "@/components/language-provider";
import { DemoPageThumbnail } from "./DemoPageThumbnail";
import { type DemoAction, type DemoState } from "./types";
import type { DemoCopy } from "./copy";
import { demoRect } from "./displayGeometry";

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
  return (
    <button
      className="demo-thumbnail"
      type="button"
      aria-label={t("sidebar.page", { page })}
      aria-current={state.page === page ? "page" : undefined}
      onClick={() => dispatch({ type: "page", page })}
    >
      <DemoPageThumbnail
        page={state.pages[page - 1]}
        state={state}
        copy={copy}
      />
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
    const viewport = demoRect(root);
    const box = demoRect(active);
    if (box.top < viewport.top) root.scrollTop += box.top - viewport.top;
    else if (box.bottom > viewport.bottom)
      root.scrollTop += box.bottom - viewport.bottom;
  }, [props.state.page]);
  return (
    <div ref={scroll} className="demo-sidebar-scroll demo-thumbnails">
      {props.state.pages.map((page, index) => (
        <DemoThumbnail key={page.id} page={index + 1} {...props} />
      ))}
    </div>
  );
}
