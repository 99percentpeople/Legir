import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent,
} from "react";
import { ArrowUpRight, Plus, X } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import {
  RightPanelTabDock,
  type RightPanelTabId,
} from "@/components/properties-panel/RightPanelTabDock";
import FloatingBar from "@/components/toolbar/FloatingBar";
import MobileFloatingToolbar from "@/components/toolbar/MobileFloatingToolbar";
import {
  ANNOTATION_STYLES,
  DEFAULT_EDITOR_UI_STATE,
  WORKSPACE_BASE_PAGE_GAP_PX,
} from "@/constants";
import { pdfViewerScaleToWorkspaceScale } from "@/lib/pdfScale";
import type { PreviewMode } from "../../content/types";
import { resolveAppUrl } from "../../lib/app-url";
import { getDemoCopy } from "./copy";
import {
  DOCUMENT_TITLE,
  demoReducer,
  initialDemoState,
  type DemoAction,
} from "./types";
import {
  DEMO_PAGES,
  DEMO_CANVAS_PADDING,
  PAPER_WIDTH,
  PAPER_HEIGHT,
  demoFitZoom,
  demoPageGroups,
} from "./geometry";
import { DemoDocument } from "./DemoDocument";
import { DemoAiPanel } from "./DemoPanels";
import { DemoTranslationWindow } from "./DemoTranslationWindow";
import { DemoSidebar } from "./DemoSidebar";
import { DemoToolbar } from "./DemoToolbar";
import { useDemoViewport } from "./useDemoViewport";
import { useDemoNavigation } from "./useDemoNavigation";
import "./demo.css";

const DemoDocumentPanel = lazy(() =>
  import("./DemoDocumentPanel").then((module) => ({
    default: module.DemoDocumentPanel,
  })),
);
type Props = { mode: PreviewMode; language: string; appLabel: string };

export function WorkspaceDemo({ mode, language, appLabel }: Props) {
  const copy = getDemoCopy(language);
  const { t } = useLanguage();
  const [state, rawDispatch] = useReducer(demoReducer, initialDemoState);
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const hostSize = useDemoViewport(host);
  const stageSize = useDemoViewport(stage);
  const compact = hostSize.width < 768;
  const [sidebarWidth, setSidebarWidth] = useState(
    DEFAULT_EDITOR_UI_STATE.sidebarWidth,
  );
  const [panelWidth, setPanelWidth] = useState(
    DEFAULT_EDITOR_UI_STATE.rightPanelWidth,
  );
  const [filename, setFilename] = useState(DOCUMENT_TITLE);
  const [fullscreen, setFullscreen] = useState(false);
  const [selectionRequest, setSelectionRequest] = useState<{
    id: number;
    text: string;
    page: number;
  } | null>(null);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const appUrl = resolveAppUrl(
    import.meta.env.VITE_APP_URL,
    typeof window === "undefined" ? undefined : window.location,
  );
  const openApp = () => {
    window.location.href = appUrl;
  };
  const dispatch: Dispatch<DemoAction> = useCallback(
    (action) => {
      // The app makes side panels floating and mutually exclusive on small screens.
      if (compact) {
        if (action.type === "panel" && action.panel)
          rawDispatch({ type: "hide-sidebar" });
        if (action.type === "sidebar")
          rawDispatch({ type: "panel", panel: null });
        if (action.type === "page" || action.type === "select-field")
          rawDispatch({ type: "close-panels" });
      }
      rawDispatch(action);
    },
    [compact],
  );

  useEffect(() => {
    rawDispatch({ type: "mode", mode });
  }, [mode]);
  useEffect(() => {
    // Changing viewport must not replay a preset or discard the current page,
    // active tool, open translation, or conversation.
    if (compact) rawDispatch({ type: "hide-sidebar" });
  }, [mode, compact]);

  useLayoutEffect(() => {
    if (!state.fit) return;
    const zoom = demoFitZoom(state, stageSize);
    if (Math.abs(zoom - state.zoom) > 0.01)
      rawDispatch({ type: "scale", zoom });
  }, [
    state.fit,
    state.layout,
    state.flow,
    state.navigationToken,
    stageSize,
    state.zoom,
  ]);
  const onStageScroll = useDemoNavigation(stage, state, rawDispatch);

  useEffect(() => {
    const onChange = () =>
      setFullscreen(document.fullscreenElement === host.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await host.current?.requestFullscreen();
    } catch {
      /* Embedded or restricted browsers can disallow fullscreen. */
    }
  }
  function askSelection(page: number) {
    dispatch({ type: "panel", panel: "ai" });
    setSelectionRequest((previous) => ({
      id: (previous?.id ?? 0) + 1,
      text: state.selection,
      page,
    }));
  }
  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (
      state.tool !== "pan" ||
      (event.target as HTMLElement).closest("button,input,textarea,select,a")
    )
      return;
    event.preventDefault();
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      left: event.currentTarget.scrollLeft,
      top: event.currentTarget.scrollTop,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function movePan(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    event.currentTarget.scrollLeft =
      drag.current.left - event.clientX + drag.current.x;
    event.currentTarget.scrollTop =
      drag.current.top - event.clientY + drag.current.y;
  }
  function selectDock(tab: RightPanelTabId) {
    const panel = tab === "ai_chat" ? "ai" : "document";
    dispatch({ type: "panel", panel: state.panel === panel ? null : panel });
  }
  const scale = state.zoom / 100;
  const commonPanel = {
    state,
    dispatch,
    copy,
    width: Math.min(panelWidth, hostSize.width - 16),
    onResize: setPanelWidth,
    floating: compact,
  };
  const navigate = (pageIndex: number) =>
    dispatch({ type: "page", page: pageIndex + 1 });
  const groups = demoPageGroups(state.layout);

  return (
    <div
      ref={host}
      className="demo-editor"
      data-panel={state.panel ?? "none"}
      data-tool={state.tool}
      data-compact={compact}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          compact &&
          (state.sidebar || state.panel)
        ) {
          event.preventDefault();
          rawDispatch({ type: "close-panels" });
        }
      }}
    >
      <div className="demo-filebar">
        <div className="demo-file-tab group">
          <span title={filename}>{filename}</span>
          <span className="relative block h-4 w-4 shrink-0">
            {state.dirty && (
              <span className="demo-dirty-dot pointer-events-none absolute inset-0 flex items-center justify-center group-hover:opacity-0">
                <span className="bg-foreground h-1.5 w-1.5 rounded-full" />
              </span>
            )}
            <button
              type="button"
              className={`text-muted-foreground hover:text-foreground absolute inset-0 flex items-center justify-center rounded-full transition-opacity ${state.dirty ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100" : ""}`}
              title={t("common.actions.close")}
              aria-label={t("common.actions.close")}
              onClick={openApp}
            >
              <X size={12} />
            </button>
          </span>
        </div>
        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
          <a href={appUrl} aria-label={appLabel} title={appLabel}>
            <Plus size={16} />
          </a>
        </Button>
        <span className="demo-live-badge">{copy.badge}</span>
      </div>
      <DemoToolbar
        state={state}
        dispatch={dispatch}
        compact={compact}
        onOpenApp={openApp}
        onToggleFullscreen={() => void toggleFullscreen()}
        fullscreen={fullscreen}
      />
      <div className="demo-editor-body">
        {compact && (state.sidebar || state.panel) && (
          <button
            type="button"
            className="demo-panel-backdrop absolute inset-0 z-35 bg-black/20"
            aria-label={t("common.actions.close")}
            onClick={() => rawDispatch({ type: "close-panels" })}
          />
        )}
        {state.sidebar && (
          <DemoSidebar
            state={state}
            dispatch={dispatch}
            copy={copy}
            width={Math.min(sidebarWidth, hostSize.width - 16)}
            onResize={setSidebarWidth}
            floating={compact}
          />
        )}
        <div className="demo-canvas-pane">
          <div
            className="demo-stage"
            ref={stage}
            onScroll={onStageScroll}
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
          >
            <div
              className="demo-page-stack"
              data-flow={state.flow}
              style={{
                paddingTop: DEMO_CANVAS_PADDING,
                paddingInline: DEMO_CANVAS_PADDING,
                gap:
                  WORKSPACE_BASE_PAGE_GAP_PX *
                  pdfViewerScaleToWorkspaceScale(scale),
              }}
            >
              {groups.map((group) => (
                <div
                  key={group[0]}
                  className="demo-page-group"
                  style={{
                    gap:
                      WORKSPACE_BASE_PAGE_GAP_PX *
                      pdfViewerScaleToWorkspaceScale(scale),
                  }}
                >
                  {group.map((page) => (
                    <div
                      className="demo-paper-frame"
                      key={page}
                      data-demo-page={page}
                      style={{
                        width: PAPER_WIDTH * scale,
                        height: PAPER_HEIGHT * scale,
                      }}
                    >
                      <DemoDocument
                        state={{ ...state, page }}
                        dispatch={dispatch}
                        copy={copy}
                        onAskSelection={() => askSelection(page)}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          {compact ? (
            <MobileFloatingToolbar
              currentPageIndex={state.page - 1}
              editorState={{
                mode: state.editorMode,
                tool: state.tool,
                pages: DEMO_PAGES,
                documentLoadState: "ready",
                documentPermissions: null,
                penStyle: ANNOTATION_STYLES.ink,
                highlightStyle: {
                  ...ANNOTATION_STYLES.highlight,
                  color: state.highlightColor,
                },
                commentStyle: ANNOTATION_STYLES.comment,
                freetextStyle: ANNOTATION_STYLES.freetext,
                shapeStyle: ANNOTATION_STYLES.shape,
                stampStyle: ANNOTATION_STYLES.stamp,
              }}
              onNavigatePage={navigate}
              onToolChange={(tool) => dispatch({ type: "tool", tool })}
              onModeChange={(next) =>
                dispatch({ type: "editor-mode", mode: next })
              }
              onPenStyleChange={() => {}}
              onHighlightStyleChange={(style) => {
                if (style.color)
                  dispatch({ type: "highlight-color", color: style.color });
              }}
            />
          ) : (
            <FloatingBar
              currentPageIndex={state.page - 1}
              pageCount={3}
              pageLayout={state.layout}
              pageFlow={state.flow}
              isFullscreen={fullscreen}
              onNavigatePage={navigate}
              onPageLayoutChange={(layout) =>
                dispatch({ type: "layout", layout })
              }
              onPageFlowChange={(flow) => dispatch({ type: "flow", flow })}
              onToggleFullscreen={() => void toggleFullscreen()}
            />
          )}
        </div>
        <DemoAiPanel {...commonPanel} selectionRequest={selectionRequest} />
        {state.panel === "document" && (
          <Suspense
            fallback={
              <div
                className="bg-background border-border shrink-0 border-l"
                style={{ width: commonPanel.width }}
              />
            }
          >
            <DemoDocumentPanel
              {...commonPanel}
              filename={filename}
              onFilenameChange={setFilename}
            />
          </Suspense>
        )}
        <RightPanelTabDock
          activeTabs={
            state.panel ? [state.panel === "ai" ? "ai_chat" : state.panel] : []
          }
          isFloating={compact}
          rightOffsetPx={compact ? 0 : state.panel ? commonPanel.width : 0}
          scrollContainer={stage.current}
          canOpenProperties={false}
          canOpenPageTranslate={false}
          onSelectTab={selectDock}
          onOpenTranslate={() =>
            dispatch({ type: "translate", open: true, auto: true })
          }
        />
        <DemoTranslationWindow
          state={state}
          dispatch={dispatch}
          copy={copy}
          language={language}
        />
      </div>
      <div className="demo-statusbar">
        <span>{copy.hints[mode]}</span>
        <a href={appUrl}>
          {appLabel}
          <ArrowUpRight size={12} />
        </a>
      </div>
    </div>
  );
}
