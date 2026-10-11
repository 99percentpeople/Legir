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
  type CSSProperties,
  type PointerEvent,
} from "react";
import { Home, MousePointer2, Plus, TextCursor, X } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import {
  RightPanelTabDock,
  type RightPanelTabId,
} from "@/components/properties-panel/RightPanelTabDock";
import FloatingBar from "@/components/toolbar/FloatingBar";
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
  DEMO_CANVAS_PADDING,
  demoPageSize,
  demoFitZoom,
  demoPageGroups,
} from "./geometry";
import { DemoDocument } from "./DemoDocument";
import { DemoAiPanel } from "./DemoPanels";
import { DemoTranslationWindow } from "./DemoTranslationWindow";
import { DemoSidebar } from "./DemoSidebar";
import { DemoToolbar } from "./DemoToolbar";
import { useDemoViewport } from "./useDemoViewport";
import { demoDisplayScale } from "./displayGeometry";
import { useDemoNavigation } from "./useDemoNavigation";
import { DemoPageEditor } from "./DemoPageEditor";
import { useDemoAutoplay, type DemoChatCue } from "./useDemoAutoplay";
import type { DragDropManager } from "@dnd-kit/dom";
import "@/pages/EditorPage/components/EditorTabStrip.css";
import "./demo.css";

const DemoDocumentPanel = lazy(() =>
  import("./DemoDocumentPanel").then((module) => ({
    default: module.DemoDocumentPanel,
  })),
);
type Props = {
  mode: PreviewMode;
  language: string;
  appLabel: string;
  onModeChange: (mode: PreviewMode) => void;
  autoplay: boolean;
  onPause: () => void;
};

export function WorkspaceDemo({
  mode,
  language,
  appLabel,
  onModeChange,
  autoplay,
  onPause,
}: Props) {
  const copy = getDemoCopy(language);
  const { t } = useLanguage();
  const [state, rawDispatch] = useReducer(demoReducer, initialDemoState);
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const viewportSize = useDemoViewport(viewport);
  const stage = useRef<HTMLDivElement>(null);
  const pageDrag = useRef<DragDropManager | null>(null);
  const hostSize = useDemoViewport(host);
  const stageSize = useDemoViewport(stage);
  const compact = hostSize.width < 768;
  const pageToOpen = useRef<number | null>(null);
  const pageMode = state.editorMode === "pages";
  const [chatCue, setChatCue] = useState<DemoChatCue | null>(null);
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
      if (action.type === "editor-mode") {
        onModeChange(
          action.mode === "pages"
            ? "pages"
            : action.mode === "form"
              ? "forms"
              : "read",
        );
      }
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
    [compact, onModeChange],
  );

  useLayoutEffect(() => {
    rawDispatch({ type: "mode", mode });
    if (pageToOpen.current !== null) {
      rawDispatch({ type: "page", page: pageToOpen.current + 1 });
      pageToOpen.current = null;
    }
  }, [mode]);
  useEffect(() => {
    // Changing viewport must not replay a preset or discard the current page,
    // active tool, open translation, or conversation.
    if (compact) rawDispatch({ type: "hide-sidebar" });
  }, [mode, compact]);

  useLayoutEffect(() => {
    if (!state.fit || pageMode) return;
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
    state.pages,
    pageMode,
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
      page: state.pages[page - 1]?.sourcePage ?? 1,
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
    const displayScale = demoDisplayScale(event.currentTarget);
    event.currentTarget.scrollLeft =
      drag.current.left - (event.clientX - drag.current.x) / displayScale;
    event.currentTarget.scrollTop =
      drag.current.top - (event.clientY - drag.current.y) / displayScale;
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
  const groups = demoPageGroups(state.layout, state.pages.length);
  const playback = useDemoAutoplay({
    host,
    mode,
    enabled: autoplay,
    copy,
    dispatch,
    onChat: setChatCue,
    onNext: onModeChange,
    pageDrag,
  });

  return (
    <div className="workspace-live" ref={viewport}>
      <div
        ref={host}
        className="demo-editor"
        style={{ "--demo-scale": viewportSize.width / 1200 } as CSSProperties}
        data-panel={state.panel ?? "none"}
        data-tool={state.tool}
        data-compact={compact}
        data-page-mode={pageMode}
        data-autoplay={playback.running}
        data-demo-step={playback.stepIndex}
        onPointerDownCapture={onPause}
        onKeyDownCapture={onPause}
        onInput={() => queueMicrotask(onPause)}
        onWheelCapture={onPause}
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
        <span
          ref={playback.cursorRef}
          className="demo-playback-cursor"
          aria-hidden="true"
          hidden={!playback.running}
        >
          <span className="demo-cursor-ring" />
          <MousePointer2 className="demo-cursor-arrow" size={24} />
          <TextCursor className="demo-cursor-text" size={22} />
        </span>
        <div className="demo-filebar editor-tab-strip">
          <div className="editor-tab-slot shrink-0">
            <a
              className="editor-tab demo-file-tab text-muted-foreground"
              href={appUrl}
              aria-label={t("tabs.home")}
              title={t("tabs.home")}
            >
              <Home size={16} />
              <span>{t("tabs.home")}</span>
            </a>
          </div>
          <div className="editor-tab-slot min-w-0">
            <div className="editor-tab editor-tab--active demo-file-tab group">
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
          </div>
          <Button asChild variant="ghost" size="icon" className="h-8 w-8">
            <a href={appUrl} aria-label={appLabel} title={appLabel}>
              <Plus size={16} />
            </a>
          </Button>
        </div>
        <DemoToolbar
          state={state}
          dispatch={dispatch}
          compact={compact}
          onOpenApp={openApp}
          onToggleFullscreen={() => void toggleFullscreen()}
          fullscreen={fullscreen}
        />
        <div className="demo-editor-body" data-page-mode={pageMode}>
          {pageMode && (
            <DemoPageEditor
              dragManager={pageDrag}
              state={state}
              dispatch={dispatch}
              copy={copy}
              onOpen={(index) => {
                pageToOpen.current = index;
                onModeChange("read");
              }}
            />
          )}
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
                    {group.map((pageNumber) => {
                      const page = state.pages[pageNumber - 1];
                      const size = demoPageSize(page);
                      return (
                        <div
                          className="demo-paper-frame"
                          key={page.id}
                          data-demo-page={pageNumber}
                          data-demo-page-id={page.id}
                          data-source-page={page.sourcePage}
                          data-rotation={page.rotation}
                          style={{
                            width: size.width * scale,
                            height: size.height * scale,
                          }}
                        >
                          {page.sourcePage !== null && (
                            <DemoDocument
                              page={page}
                              state={{ ...state, page: page.sourcePage }}
                              dispatch={dispatch}
                              copy={copy}
                              onAskSelection={() => askSelection(pageNumber)}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <FloatingBar
              isMobile={compact}
              state={{
                mode: state.editorMode,
                tool: state.tool,
                keys: {
                  ctrl: false,
                  shift: false,
                  alt: false,
                  meta: false,
                  space: false,
                },
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
              commands={{
                changeTool: (tool) => dispatch({ type: "tool", tool }),
                exitTool: () =>
                  dispatch({ type: "tool", tool: compact ? "pan" : "select" }),
                changeMode: (mode) => {
                  dispatch({ type: "editor-mode", mode });
                },
                changePenStyle: () => {},
                changeHighlightStyle: (style) => {
                  if (style.color)
                    dispatch({ type: "highlight-color", color: style.color });
                },
                changeCommentStyle: () => {},
                changeFreetextStyle: () => {},
                changeShapeStyle: () => {},
                changeStampStyle: () => {},
              }}
              currentPageIndex={state.page - 1}
              pageCount={state.pages.length}
              enablePageEditing
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
          </div>
          <DemoAiPanel
            {...commonPanel}
            selectionRequest={selectionRequest}
            autoplayCue={chatCue}
          />
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
              state.panel
                ? [state.panel === "ai" ? "ai_chat" : state.panel]
                : []
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
            stopToken={chatCue?.kind === "stop" ? chatCue.token : undefined}
          />
        </div>
      </div>
    </div>
  );
}
