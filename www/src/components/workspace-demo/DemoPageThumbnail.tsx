import { useRef, type CSSProperties } from "react";
import { DemoDocumentContent } from "./DemoDocumentContent";
import { useDemoViewport } from "./useDemoViewport";
import { demoPageSize } from "./geometry";
import type { DemoPage, DemoState } from "./types";
import type { DemoCopy } from "./copy";

export function DemoPageThumbnail({
  page,
  state,
  copy,
}: {
  page: DemoPage;
  state: DemoState;
  copy: DemoCopy;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const { width } = useDemoViewport(frame);
  const size = demoPageSize(page);
  return (
    <div
      ref={frame}
      className="demo-mini-paper"
      style={{ aspectRatio: size.width / size.height }}
      aria-hidden="true"
      inert
    >
      {page.sourcePage !== null && (
        <div
          className="demo-paper"
          lang="en"
          style={
            {
              "--demo-zoom": width / size.width,
              "--demo-highlight": state.highlightColor,
              top: "50%",
              left: "50%",
              transformOrigin: "center",
              transform: `translate(-50%, -50%) rotate(${page.rotation}deg) scale(var(--demo-zoom))`,
            } as CSSProperties
          }
        >
          <DemoDocumentContent
            state={{
              ...state,
              page: page.sourcePage,
            }}
            copy={copy}
            thumbnail
          />
        </div>
      )}
    </div>
  );
}
