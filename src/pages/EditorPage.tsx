import React, { Suspense, useCallback, useEffect, useRef } from "react";
import Toolbar from "../components/toolbar/Toolbar";
import Sidebar from "../components/sidebar/Sidebar";
import ZoomControls from "../components/toolbar/ZoomControls";
import { Skeleton } from "../components/ui/skeleton";
import { useEditorStore, type EditorStore } from "../store/useEditorStore";
import { Button } from "../components/ui/button";
import { appEventBus } from "@/lib/eventBus";
import { RightPanelTabDock } from "../components/properties-panel/RightPanelTabDock";
import { PropertiesPanel } from "../components/properties-panel/PropertiesPanel";
import { AIDetectionPanel } from "../components/properties-panel/AIDetectionPanel";
import { useIsMobile } from "../hooks/useIsMobile";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { useEventListener } from "@/hooks/useEventListener";

const Workspace = React.lazy(() => import("../components/workspace/Workspace"));
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "../components/ui/dialog";
import { useLanguage } from "../components/language-provider";
import type {
  Annotation,
  EditorState,
  FormField,
  PDFMetadata,
  Tool,
} from "../types";
import type { AIDetectionOptions } from "../components/AIDetectionOptionsForm";
import {
  ANNOTATION_STYLES,
  FIT_SCREEN_PADDING_X,
  FIT_SCREEN_PADDING_Y,
  FIT_WIDTH_PADDING_X,
  WORKSPACE_BASE_PAGE_GAP_PX,
} from "../constants";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { recentFilesService } from "../services/recentFilesService";

export interface EditorPageProps {
  editorStore: EditorStore;

  onExport: () => Promise<boolean>;
  onSaveDraft: (silent?: boolean) => Promise<void>;
  onSaveAs: () => Promise<boolean>;
  onExit: () => void;
  onPrint: () => void;
  onAdvancedDetect: (options: AIDetectionOptions) => void;
}

const EditorPage: React.FC<EditorPageProps> = ({
  editorStore,
  onExport,
  onSaveDraft,
  onSaveAs,
  onExit,
  onPrint,
  onAdvancedDetect,
}) => {
  const state = editorStore;
  const tauri = isTauri();
  const { t } = useLanguage();
  const {
    setState,
    setUiState,
    addField,
    addAnnotation,
    updateField,
    updateAnnotation,
    deleteSelection,
    selectControl,
    setTool,
    saveCheckpoint,
    undo,
    redo,
    deleteAnnotation,
    openDialog,
  } = editorStore;

  const isMobile = useIsMobile();
  const prevSelectedIdRef = useRef<string | null>(null);
  const lastFitKeyRef = useRef<string | null>(null);
  const skipNextWindowCloseRef = useRef(false);
  const initialTitleRef = useRef<string | null>(null);
  const workspaceScrollContainerRef = useRef<HTMLElement | null>(null);

  useAppEvent(
    "workspace:scrollContainerReady",
    ({ element }) => {
      workspaceScrollContainerRef.current = element;
    },
    { replayLast: true },
  );

  const selectedField =
    state.selectedId && state.fields.find((f) => f.id === state.selectedId)
      ? state.fields.find((f) => f.id === state.selectedId) || null
      : null;

  const selectedAnnotation =
    state.selectedId && state.annotations.find((a) => a.id === state.selectedId)
      ? state.annotations.find((a) => a.id === state.selectedId) || null
      : null;

  const selectedControl = selectedField || selectedAnnotation;

  useEffect(() => {
    setState({ isPanelFloating: isMobile });

    if (isMobile) {
      setUiState((prev) => {
        if (!prev.isSidebarOpen || !prev.isRightPanelOpen) return prev;
        return { isSidebarOpen: true, isRightPanelOpen: false };
      });
    }
  }, [isMobile, setState, setUiState]);

  useEffect(() => {
    if (!state.isPanelFloating) return;
    if (state.isSidebarOpen && state.isRightPanelOpen) {
      setUiState({ isRightPanelOpen: false });
    }
  }, [
    state.isPanelFloating,
    state.isSidebarOpen,
    state.isRightPanelOpen,
    setUiState,
  ]);

  useEffect(() => {
    const prev = prevSelectedIdRef.current;
    const next = state.selectedId;
    if (!prev && next) {
      setUiState({ rightPanelTab: "properties" });
    }
    prevSelectedIdRef.current = next;
  }, [state.selectedId, setUiState]);

  useEffect(() => {
    if (!state.selectedId && state.rightPanelTab === "properties") {
      setUiState({ rightPanelTab: "document" });
    }
  }, [state.selectedId, state.rightPanelTab, setUiState]);

  useEffect(() => {
    const appName = process.env.APP_NAME;

    if (!tauri && typeof document !== "undefined") {
      if (initialTitleRef.current === null) {
        initialTitleRef.current = document.title;
      }
    }

    const hasOpenDocument = state.pages.length > 0;
    const nextTitle = hasOpenDocument
      ? `${state.filename || appName} - ${appName}`
      : appName;

    if (tauri) {
      let cancelled = false;
      void (async () => {
        try {
          if (cancelled) return;
          const win = getCurrentWindow();
          await win.setTitle(nextTitle);
        } catch {
          // ignore
        }
      })();

      return () => {
        cancelled = true;
        void (async () => {
          try {
            const win = getCurrentWindow();
            await win.setTitle(appName);
          } catch {
            // ignore
          }
        })();
      };
    }

    if (typeof document !== "undefined") {
      document.title = nextTitle;
    }

    return () => {
      if (typeof document !== "undefined") {
        document.title = initialTitleRef.current ?? appName;
      }
    };
  }, [tauri, state.filename, state.pages.length, t]);

  useEffect(() => {
    if (tauri) {
      if (state.pages.length === 0) return;

      let unlisten: null | (() => void) = null;
      let cancelled = false;
      (async () => {
        const win = getCurrentWindow();
        unlisten = await win.onCloseRequested((event: any) => {
          if (skipNextWindowCloseRef.current) {
            skipNextWindowCloseRef.current = false;
            return;
          }

          recentFilesService.cancelPreviewTasks();

          const { isDirty, pages, setState } = useEditorStore.getState();
          if (!pages || pages.length === 0) return;

          const snapshot = useEditorStore.getState();
          const tauriPath =
            snapshot.saveTarget?.kind === "tauri"
              ? snapshot.saveTarget.path
              : null;
          if (tauriPath) {
            const el = workspaceScrollContainerRef.current;
            if (el) {
              recentFilesService.saveTauriViewState({
                path: tauriPath,
                scale: snapshot.scale,
                pageIndex: snapshot.currentPageIndex,
                element: el,
              });
            }
          }

          if (!isDirty) return;
          try {
            event?.preventDefault?.();
          } catch {
            // ignore
          }
          setState({
            activeDialog: "close_confirm",
            closeConfirmSource: "window",
          });
        });

        if (cancelled) {
          try {
            unlisten?.();
          } catch {
            // ignore
          }
          unlisten = null;
        }
      })();

      return () => {
        cancelled = true;
        try {
          unlisten?.();
        } catch {
          // ignore
        }
      };
    }
  }, [tauri, state.isDirty, state.pages.length]);

  const closeConfirmOpen = state.activeDialog === "close_confirm";
  const closeSource = state.closeConfirmSource || "menu";

  const closeDialog = () => {
    setState({ activeDialog: null, closeConfirmSource: null });
  };

  const closeWindow = async () => {
    recentFilesService.cancelPreviewTasks();
    const snapshot = useEditorStore.getState();
    const tauriPath =
      snapshot.saveTarget?.kind === "tauri" ? snapshot.saveTarget.path : null;
    if (tauriPath) {
      const el = workspaceScrollContainerRef.current;
      if (el) {
        recentFilesService.saveTauriViewState({
          path: tauriPath,
          scale: snapshot.scale,
          pageIndex: snapshot.currentPageIndex,
          element: el,
        });
      }
    }

    skipNextWindowCloseRef.current = true;
    await getCurrentWindow().close();
  };

  const persistWebViewState = useCallback(() => {
    const snapshot = useEditorStore.getState();
    if (!snapshot.pages || snapshot.pages.length === 0) return;
    const el = workspaceScrollContainerRef.current;
    if (!el) return;
    recentFilesService.saveWebDraftView({ scale: snapshot.scale, element: el });
  }, []);

  useEventListener<BeforeUnloadEvent>(
    !tauri && typeof window !== "undefined" ? window : null,
    "beforeunload",
    (e) => {
      if (state.pages.length > 0 && state.isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    },
  );

  useEventListener(
    !tauri && typeof window !== "undefined" ? window : null,
    "pagehide",
    () => {
      persistWebViewState();
      const snapshot = useEditorStore.getState();
      if (snapshot.isDirty) {
        void onSaveDraft(true);
      }
    },
  );

  useEventListener(
    !tauri && typeof document !== "undefined" ? document : null,
    "visibilitychange",
    () => {
      if (document.visibilityState !== "hidden") return;
      persistWebViewState();
      const snapshot = useEditorStore.getState();
      if (snapshot.isDirty) {
        void onSaveDraft(true);
      }
    },
  );

  useEffect(() => {
    if (tauri) return;
    if (state.pages.length > 0 && state.pdfBytes) {
      const timer = setTimeout(() => {
        if (!state.isDirty) return;
        void onSaveDraft(true);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [
    tauri,
    state.isDirty,
    state.fields,
    state.annotations,
    state.metadata,
    state.filename,
    state.pages.length,
    state.pdfBytes,
    onSaveDraft,
  ]);

  const getWorkspaceViewport = useCallback(() => {
    const el = workspaceScrollContainerRef.current;
    if (el) return { width: el.clientWidth, height: el.clientHeight };
    if (typeof window !== "undefined") {
      return { width: window.innerWidth, height: window.innerHeight };
    }
    return { width: 0, height: 0 };
  }, []);

  const calculateFitWidthScale = useCallback(
    (pageIndex: number = 0) => {
      if (!state.pages || state.pages.length === 0) return 1.0;
      const targetIndex = Math.max(
        0,
        Math.min(pageIndex, state.pages.length - 1),
      );
      const page = state.pages[targetIndex];
      if (!page.width) return 1.0;

      const { width } = getWorkspaceViewport();
      const availableWidth = width - FIT_WIDTH_PADDING_X;
      if (state.pageLayout === "double") {
        const denom = page.width * 2 + WORKSPACE_BASE_PAGE_GAP_PX;
        const scale = denom > 0 ? availableWidth / denom : 1.0;
        return Math.max(0.25, Math.min(5.0, Number(scale.toFixed(2))));
      }

      const scale = availableWidth / page.width;
      return Math.max(0.25, Math.min(5.0, Number(scale.toFixed(2))));
    },
    [state.pages, state.pageLayout, getWorkspaceViewport],
  );

  const calculateFitScreenScale = useCallback(
    (pageIndex: number = 0) => {
      if (!state.pages || state.pages.length === 0) return 1.0;
      const targetIndex = Math.max(
        0,
        Math.min(pageIndex, state.pages.length - 1),
      );
      const page = state.pages[targetIndex];
      if (!page.width || !page.height) return 1.0;

      const { width, height } = getWorkspaceViewport();
      const availableWidth = width - FIT_SCREEN_PADDING_X;
      const availableHeight = height - FIT_SCREEN_PADDING_Y;

      const widthScale =
        state.pageLayout === "double"
          ? (() => {
              const denom = page.width * 2 + WORKSPACE_BASE_PAGE_GAP_PX;
              return denom > 0 ? availableWidth / denom : 1.0;
            })()
          : availableWidth / page.width;
      const heightScale = availableHeight / page.height;
      const scale = Math.min(widthScale, heightScale);
      return Math.max(0.25, Math.min(5.0, Number(scale.toFixed(2))));
    },
    [state.pages, state.pageLayout, getWorkspaceViewport],
  );

  const updateScale = useCallback(
    (newScale: number) => {
      const clamped = Math.max(0.25, Math.min(5.0, newScale));
      setState({ scale: clamped });
    },
    [setState],
  );

  useEffect(() => {
    if (!state.pages || state.pages.length === 0) return;
    const bytesLen =
      typeof state.pdfBytes?.byteLength === "number"
        ? state.pdfBytes.byteLength
        : state.pdfBytes?.length;
    const fitKey = `${state.filename || ""}:${state.pages.length}:${bytesLen || 0}`;
    if (lastFitKeyRef.current === fitKey) return;
    lastFitKeyRef.current = fitKey;

    if (state.pendingViewStateRestore) {
      const restore = state.pendingViewStateRestore;
      updateScale(restore.scale);

      requestAnimationFrame(() => {
        const el = workspaceScrollContainerRef.current;
        if (!el) return;
        el.scrollLeft = restore.scrollLeft;
        el.scrollTop = restore.scrollTop;
        setState({ pendingViewStateRestore: null });
      });
      return;
    }

    updateScale(calculateFitScreenScale(state.currentPageIndex));
    setState({ fitTrigger: Date.now() });
  }, [
    state.pages,
    state.pdfBytes,
    state.filename,
    state.currentPageIndex,
    state.pendingViewStateRestore,
    calculateFitScreenScale,
    updateScale,
    setState,
  ]);

  useEventListener<KeyboardEvent>(
    typeof window !== "undefined" ? window : null,
    "keydown",
    (e) => {
      const currentState = useEditorStore.getState();

      if (
        e.key === "Control" ||
        e.key === "Shift" ||
        e.key === "Alt" ||
        e.key === "Meta"
      ) {
        currentState.setKeys({
          ctrl: e.ctrlKey,
          shift: e.shiftKey,
          alt: e.altKey,
          meta: e.metaKey,
          space: currentState.keys.space,
        });
        return;
      }

      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (e.key === " " && !isInput) {
        e.preventDefault();
        e.stopPropagation();
        if (!currentState.keys.space) {
          currentState.setKeys({ space: true });
        }
        return;
      }

      if (e.key === "Escape") {
        if (currentState.activeDialog) return;
        if (isInput) target.blur();
        if (currentState.selectedId) {
          currentState.selectControl(null);
        } else if (currentState.tool !== "select") {
          currentState.setTool("select");
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (tauri) {
          if (!currentState.isDirty) return;
          void onExport();
          return;
        }
        onSaveDraft(false);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        onPrint();
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (isInput && !(target as HTMLInputElement).readOnly) {
          return;
        }
        const isSelectedField = currentState.fields.some(
          (f) => f.id === currentState.selectedId,
        );
        if (currentState.mode === "annotation" && isSelectedField) {
          return;
        }
        currentState.deleteSelection();
        return;
      }

      if (isInput && !(target as HTMLInputElement).readOnly) {
        return;
      }

      if (
        currentState.mode === "form" &&
        currentState.selectedId &&
        currentState.fields.some((f) => f.id === currentState.selectedId) &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
      ) {
        e.preventDefault();
        const isFast = e.shiftKey;
        let direction: "UP" | "DOWN" | "LEFT" | "RIGHT" = "UP";
        if (e.key === "ArrowUp") direction = "UP";
        else if (e.key === "ArrowDown") direction = "DOWN";
        else if (e.key === "ArrowLeft") direction = "LEFT";
        else if (e.key === "ArrowRight") direction = "RIGHT";
        currentState.moveField(direction, isFast);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (e.shiftKey) currentState.redo();
        else currentState.undo();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        currentState.redo();
        return;
      }

      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        currentState.openDialog("shortcuts");
        return;
      }
    },
    true,
  );

  useEventListener<KeyboardEvent>(
    typeof window !== "undefined" ? window : null,
    "keyup",
    (e) => {
      const currentState = useEditorStore.getState();
      if (
        e.key === "Control" ||
        e.key === "Shift" ||
        e.key === "Alt" ||
        e.key === "Meta"
      ) {
        currentState.setKeys({
          ctrl: e.ctrlKey,
          shift: e.shiftKey,
          alt: e.altKey,
          meta: e.metaKey,
          space: currentState.keys.space,
        });
      }

      if (e.key === " ") {
        currentState.setKeys({ space: false });
      }
    },
    true,
  );

  const handlePenStyleChange = useCallback(
    (style: Partial<EditorState["penStyle"]>) => {
      setState((prev) => ({
        ...prev,
        penStyle: { ...prev.penStyle, ...style },
      }));
    },
    [setState],
  );

  const handleHighlightStyleChange = useCallback(
    (style: Partial<EditorState["penStyle"]>) => {
      setState((prev) => ({
        ...prev,
        highlightStyle: {
          ...(prev.highlightStyle || {
            color: ANNOTATION_STYLES.highlight.color,
            thickness: ANNOTATION_STYLES.highlight.thickness,
            opacity: ANNOTATION_STYLES.highlight.opacity,
          }),
          ...style,
        },
      }));
    },
    [setState],
  );

  const handleCommentStyleChange = useCallback(
    (style: { color: string }) => {
      setState((prev) => ({
        ...prev,
        commentStyle: { ...prev.commentStyle, ...style },
      }));
    },
    [setState],
  );

  const handleFreetextStyleChange = useCallback(
    (style: { color: string }) => {
      setState((prev) => ({
        ...prev,
        freetextStyle: { ...prev.freetextStyle!, ...style },
      }));
    },
    [setState],
  );

  const handleEditAnnotation = useCallback(
    (id: string) => {
      setUiState((prev) => ({
        isSidebarOpen: true,
        sidebarTab: "annotations",
        ...(prev.isPanelFloating ? { isRightPanelOpen: false } : {}),
      }));

      selectControl(id);

      appEventBus.emit(
        "sidebar:focusAnnotation",
        { id },
        {
          sticky: true,
        },
      );
    },
    [selectControl, setUiState],
  );

  const handlePropertiesChange = useCallback(
    (updates: Partial<FormField | Annotation>) => {
      const currentSelectedId = editorStore.selectedId;
      if (!currentSelectedId) return;

      const isField = editorStore.fields.some(
        (f) => f.id === currentSelectedId,
      );
      if (isField) {
        editorStore.updateField(
          currentSelectedId,
          updates as Partial<FormField>,
        );
        return;
      }

      const isAnnotation = editorStore.annotations.some(
        (a) => a.id === currentSelectedId,
      );
      if (isAnnotation) {
        editorStore.updateAnnotation(
          currentSelectedId,
          updates as Partial<Annotation>,
        );
      }
    },
    [editorStore],
  );

  const handleMetadataChange = useCallback(
    (updates: Partial<PDFMetadata>) => {
      setState((prev) => ({
        ...prev,
        metadata: { ...prev.metadata, ...updates },
        isDirty: true,
      }));
    },
    [setState],
  );

  const handleFilenameChange = useCallback(
    (name: string) => {
      setState((prev) => ({ ...prev, filename: name, isDirty: true }));
    },
    [setState],
  );

  const canRenderRightPanel =
    state.mode === "form" || state.mode === "annotation" || selectedControl;

  return (
    <>
      <Toolbar
        editorState={state}
        isSaving={state.isSaving}
        isDirty={state.isDirty}
        onToolChange={(tool: Tool) => setTool(tool)}
        onModeChange={(mode) => setState({ mode, tool: "select" })}
        onPenStyleChange={handlePenStyleChange}
        onHighlightStyleChange={handleHighlightStyleChange}
        onCommentStyleChange={handleCommentStyleChange}
        onFreetextStyleChange={handleFreetextStyleChange}
        onExport={onExport}
        onSaveDraft={onSaveDraft}
        onSaveAs={onSaveAs}
        onExit={onExit}
        onClose={() => {
          if (!state.isDirty) {
            onExit();
            return;
          }
          setState({
            activeDialog: "close_confirm",
            closeConfirmSource: "menu",
          });
        }}
        onPrint={onPrint}
        onUndo={undo}
        onRedo={redo}
        canUndo={state.past.length > 0}
        canRedo={state.future.length > 0}
        onOpenShortcuts={() => openDialog("shortcuts")}
        isFieldListOpen={state.isSidebarOpen}
        onToggleFieldList={() =>
          setUiState((prev) => {
            const next = !prev.isSidebarOpen;
            if (prev.isPanelFloating && next)
              return { isSidebarOpen: true, isRightPanelOpen: false };
            return { isSidebarOpen: next };
          })
        }
        isPropertiesPanelOpen={state.isRightPanelOpen}
        onTogglePropertiesPanel={() =>
          setUiState((prev) => {
            const next = !prev.isRightPanelOpen;
            if (prev.isPanelFloating && next)
              return { isRightPanelOpen: true, isSidebarOpen: false };
            return { isRightPanelOpen: next };
          })
        }
        onOpenSettings={() => openDialog("settings")}
      />

      <Dialog
        open={closeConfirmOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent>
          <DialogTitle>{t("dialog.confirm_close.title")}</DialogTitle>
          <DialogDescription>
            {t("dialog.confirm_close.desc")}
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              {t("dialog.confirm_close.cancel")}
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                if (tauri) {
                  if (state.isDirty) {
                    const ok = await onExport();
                    if (!ok) return;
                  }
                  closeDialog();
                  if (closeSource === "window") {
                    await closeWindow();
                    return;
                  }
                  onExit();
                  return;
                }

                if (state.isDirty) {
                  await onSaveDraft(false);
                }
                closeDialog();
                onExit();
              }}
            >
              {tauri
                ? t("dialog.confirm_close.save_close")
                : t("dialog.confirm_close.save_draft_close")}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                closeDialog();
                if (tauri && closeSource === "window") {
                  await closeWindow();
                  return;
                }
                onExit();
              }}
            >
              {t("dialog.confirm_close.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="relative flex flex-1 overflow-hidden">
        {state.isPanelFloating &&
          (state.isSidebarOpen || state.isRightPanelOpen) && (
            <div
              className="absolute inset-0 z-30 bg-black/20"
              onMouseDown={(e) => {
                if (e.target !== e.currentTarget) return;
                setUiState({
                  isSidebarOpen: false,
                  isRightPanelOpen: false,
                });
              }}
            />
          )}

        <Sidebar
          isOpen={state.isSidebarOpen}
          onOpen={() => {
            setUiState((prev) => {
              if (prev.isPanelFloating) {
                return { isSidebarOpen: true, isRightPanelOpen: false };
              }
              return { isSidebarOpen: true };
            });
          }}
          onClose={() => setUiState({ isSidebarOpen: false })}
          isFloating={state.isPanelFloating}
          pages={state.pages}
          fields={state.fields}
          annotations={state.annotations}
          outline={state.outline}
          selectedId={state.selectedId}
          pageLayout={state.pageLayout}
          onSelectControl={(id) => {
            selectControl(id);
            if (id) {
              appEventBus.emit(
                "workspace:focusControl",
                { id, focusInput: true },
                { sticky: true },
              );
            }
          }}
          onDeleteAnnotation={deleteAnnotation}
          onUpdateAnnotation={updateAnnotation}
          onNavigatePage={(idx) => {
            document.getElementById(`page-${idx}`)?.scrollIntoView({
              behavior: "smooth",
            });
          }}
          currentPageIndex={state.currentPageIndex}
          width={state.sidebarWidth}
          onResize={(w) => setUiState({ sidebarWidth: w })}
          pdfDocument={state.pdfDocument}
          activeTab={state.sidebarTab}
          onTabChange={(tab) => setUiState({ sidebarTab: tab })}
        />

        <div className="relative z-0 flex min-w-0 flex-1 flex-col overflow-hidden">
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center p-4">
                <div className="flex gap-6">
                  <Skeleton className="h-[70vh] w-[48vh]" />
                </div>
              </div>
            }
          >
            <Workspace
              editorState={state}
              onAddField={addField}
              onAddAnnotation={addAnnotation}
              onSelectControl={selectControl}
              onUpdateField={updateField}
              onUpdateAnnotation={updateAnnotation}
              onDeleteAnnotation={deleteAnnotation}
              onEditAnnotation={handleEditAnnotation}
              onScaleChange={updateScale}
              onTriggerHistorySave={saveCheckpoint}
              onPageIndexChange={(idx) => setState({ currentPageIndex: idx })}
              onToolChange={(tool) => setTool(tool)}
              fitTrigger={state.fitTrigger}
            />
          </Suspense>
          <ZoomControls
            scale={state.scale}
            pageLayout={state.pageLayout}
            onPageLayoutChange={(layout) => {
              setState({ pageLayout: layout, fitTrigger: Date.now() });
            }}
            onZoomIn={() => updateScale(state.scale * 1.25)}
            onZoomOut={() => updateScale(state.scale / 1.25)}
            onFitWidth={() => {
              updateScale(calculateFitWidthScale(state.currentPageIndex));
              setState({ fitTrigger: Date.now() });
            }}
            onFitScreen={() => {
              updateScale(calculateFitScreenScale(state.currentPageIndex));
              setState({ fitTrigger: Date.now() });
            }}
          />
        </div>

        <RightPanelTabDock
          activeTab={state.rightPanelTab}
          isRightPanelOpen={state.isRightPanelOpen}
          isFloating={state.isPanelFloating}
          rightOffsetPx={state.isRightPanelOpen ? state.rightPanelWidth : 0}
          canOpenProperties={!!selectedControl}
          onSelectTab={(tab) => {
            if (tab === "properties" && !selectedControl) return;
            setUiState((prev) => {
              const updates: any = {
                rightPanelTab: tab,
                isRightPanelOpen: true,
              };
              if (prev.isPanelFloating) {
                updates.isSidebarOpen = false;
              }
              return updates;
            });
          }}
        />

        {canRenderRightPanel &&
          (state.rightPanelTab === "ai_detect" ? (
            <AIDetectionPanel
              isFloating={state.isPanelFloating}
              isOpen={state.isRightPanelOpen}
              onOpen={() => {
                setUiState((prev) => {
                  if (prev.isPanelFloating) {
                    return { isRightPanelOpen: true, isSidebarOpen: false };
                  }
                  return { isRightPanelOpen: true };
                });
              }}
              width={state.rightPanelWidth}
              onResize={(w) => setUiState({ rightPanelWidth: w })}
              onCollapse={() => setUiState({ isRightPanelOpen: false })}
              totalPages={state.pages.length}
              isProcessing={state.isProcessing}
              onDetect={(options) => {
                onAdvancedDetect(options);
              }}
            />
          ) : (
            <PropertiesPanel
              selectedControl={selectedControl}
              activeTab={state.rightPanelTab}
              metadata={state.metadata}
              filename={state.filename}
              onChange={handlePropertiesChange}
              onMetadataChange={handleMetadataChange}
              onFilenameChange={handleFilenameChange}
              onDelete={deleteSelection}
              onClose={() => {
                setUiState({ rightPanelTab: "document" });
                selectControl(null);
              }}
              onCollapse={() => {
                setUiState({ isRightPanelOpen: false });
              }}
              isOpen={state.isRightPanelOpen}
              onOpen={() => {
                setUiState((prev) => {
                  if (prev.isPanelFloating) {
                    return { isRightPanelOpen: true, isSidebarOpen: false };
                  }
                  return { isRightPanelOpen: true };
                });
              }}
              isFloating={state.isPanelFloating}
              onTriggerHistorySave={saveCheckpoint}
              width={state.rightPanelWidth}
              onResize={(w) => setUiState({ rightPanelWidth: w })}
            />
          ))}
      </div>
    </>
  );
};

export default EditorPage;
